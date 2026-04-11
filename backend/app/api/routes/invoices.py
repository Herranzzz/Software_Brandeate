from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, get_db, require_admin_user
from app.models.invoice import Invoice, InvoiceItem, InvoiceStatus
from app.schemas.invoice import (
    InvoiceCreate,
    InvoiceRead,
    InvoiceSendRequest,
    InvoiceUpdate,
)
from app.services.email import send_invoice_email


router = APIRouter(prefix="/invoices", tags=["invoices"])


def _invoice_query():
    return select(Invoice).options(selectinload(Invoice.items))


def _get_invoice_or_404(db: Session, invoice_id: int) -> Invoice:
    invoice = db.scalar(_invoice_query().where(Invoice.id == invoice_id))
    if invoice is None:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    return invoice


def _generate_invoice_number(db: Session, year: int) -> str:
    """Generate next sequential invoice number for the given year."""
    count = db.scalar(
        select(func.count(Invoice.id)).where(
            func.extract("year", Invoice.issue_date) == year
        )
    ) or 0
    return f"FAC-{year}-{count + 1:04d}"


def _format_currency(amount, currency: str) -> str:
    try:
        return f"{float(amount):,.2f} {currency}"
    except Exception:
        return f"{amount} {currency}"


@router.get("", response_model=list[InvoiceRead])
def list_invoices(
    status: InvoiceStatus | None = Query(default=None),
    shop_id: int | None = Query(default=None),
    q: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _user=Depends(require_admin_user),
):
    query = _invoice_query().order_by(Invoice.issue_date.desc(), Invoice.id.desc())
    if status is not None:
        query = query.where(Invoice.status == status)
    if shop_id is not None:
        query = query.where(Invoice.shop_id == shop_id)
    if q:
        like = f"%{q}%"
        query = query.where(
            Invoice.invoice_number.ilike(like)
            | Invoice.client_name.ilike(like)
            | Invoice.client_email.ilike(like)
            | Invoice.client_company.ilike(like)
        )
    offset = (page - 1) * per_page
    return list(db.scalars(query.offset(offset).limit(per_page)))


@router.post("", response_model=InvoiceRead, status_code=status.HTTP_201_CREATED)
def create_invoice(
    body: InvoiceCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_user),
):
    year = body.issue_date.year
    invoice_number = _generate_invoice_number(db, year)

    invoice = Invoice(
        invoice_number=invoice_number,
        shop_id=body.shop_id,
        status=InvoiceStatus.draft,
        client_name=body.client_name,
        client_email=body.client_email,
        client_company=body.client_company,
        client_tax_id=body.client_tax_id,
        client_address=body.client_address,
        sender_name=body.sender_name,
        sender_tax_id=body.sender_tax_id,
        sender_address=body.sender_address,
        currency=body.currency,
        tax_rate=body.tax_rate,
        notes=body.notes,
        payment_terms=body.payment_terms,
        issue_date=body.issue_date,
        due_date=body.due_date,
    )
    db.add(invoice)
    db.flush()  # get invoice.id

    for item_data in body.items:
        db.add(InvoiceItem(
            invoice_id=invoice.id,
            description=item_data.description,
            quantity=item_data.quantity,
            unit_price=item_data.unit_price,
            sort_order=item_data.sort_order,
        ))

    db.commit()
    db.refresh(invoice)
    return invoice


@router.get("/{invoice_id}", response_model=InvoiceRead)
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_user),
):
    return _get_invoice_or_404(db, invoice_id)


@router.put("/{invoice_id}", response_model=InvoiceRead)
def update_invoice(
    invoice_id: int,
    body: InvoiceUpdate,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_user),
):
    invoice = _get_invoice_or_404(db, invoice_id)
    if invoice.status not in {InvoiceStatus.draft}:
        raise HTTPException(
            status_code=400,
            detail="Solo se pueden editar facturas en estado borrador.",
        )

    update_fields = body.model_dump(exclude_unset=True, exclude={"items"})
    for field, value in update_fields.items():
        setattr(invoice, field, value)

    if body.items is not None:
        # Replace all items
        for existing_item in list(invoice.items):
            db.delete(existing_item)
        db.flush()
        for item_data in body.items:
            db.add(InvoiceItem(
                invoice_id=invoice.id,
                description=item_data.description,
                quantity=item_data.quantity,
                unit_price=item_data.unit_price,
                sort_order=item_data.sort_order,
            ))

    db.commit()
    db.refresh(invoice)
    return invoice


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_user),
):
    invoice = _get_invoice_or_404(db, invoice_id)
    if invoice.status not in {InvoiceStatus.draft, InvoiceStatus.cancelled}:
        raise HTTPException(
            status_code=400,
            detail="Solo se pueden eliminar facturas en estado borrador o canceladas.",
        )
    db.delete(invoice)
    db.commit()


@router.post("/{invoice_id}/send", response_model=InvoiceRead)
def send_invoice(
    invoice_id: int,
    body: InvoiceSendRequest,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_user),
):
    invoice = _get_invoice_or_404(db, invoice_id)
    if invoice.status == InvoiceStatus.cancelled:
        raise HTTPException(status_code=400, detail="No se puede enviar una factura cancelada.")
    if not invoice.items:
        raise HTTPException(status_code=400, detail="La factura no tiene líneas.")

    recipient = body.recipient_email or invoice.client_email

    # Build a URL that points to the print view (frontend)
    import os
    frontend_url = os.environ.get("FRONTEND_URL", "").rstrip("/")
    invoice_url = f"{frontend_url}/invoices/{invoice.id}/print" if frontend_url else ""

    send_invoice_email(
        to_email=recipient,
        to_name=invoice.client_name,
        invoice_number=invoice.invoice_number,
        invoice_total=_format_currency(invoice.total, invoice.currency),
        invoice_url=invoice_url,
        subject=body.subject or None,
        extra_message=body.message or None,
    )

    invoice.status = InvoiceStatus.sent
    invoice.sent_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(invoice)
    return invoice


@router.post("/{invoice_id}/mark-paid", response_model=InvoiceRead)
def mark_invoice_paid(
    invoice_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_user),
):
    invoice = _get_invoice_or_404(db, invoice_id)
    if invoice.status == InvoiceStatus.cancelled:
        raise HTTPException(status_code=400, detail="No se puede marcar una factura cancelada como pagada.")

    invoice.status = InvoiceStatus.paid
    invoice.paid_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(invoice)
    return invoice


@router.post("/{invoice_id}/cancel", response_model=InvoiceRead)
def cancel_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    _user=Depends(require_admin_user),
):
    invoice = _get_invoice_or_404(db, invoice_id)
    if invoice.status == InvoiceStatus.paid:
        raise HTTPException(status_code=400, detail="No se puede cancelar una factura pagada.")

    invoice.status = InvoiceStatus.cancelled
    db.commit()
    db.refresh(invoice)
    return invoice
