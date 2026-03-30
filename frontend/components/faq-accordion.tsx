type FaqAccordionItem = {
  question: string;
  answer: string;
};

type FaqAccordionProps = {
  items: FaqAccordionItem[];
};

export function FaqAccordion({ items }: FaqAccordionProps) {
  return (
    <div className="help-faq-list">
      {items.map((item) => (
        <details className="help-faq-item" key={item.question}>
          <summary className="help-faq-question">{item.question}</summary>
          <p className="subtitle help-faq-answer">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
