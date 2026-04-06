import type { ComponentPropsWithoutRef, ReactNode } from "react";


type CardProps = ComponentPropsWithoutRef<"section"> & {
  children: ReactNode;
};


export function Card({ children, className = "", ...props }: CardProps) {
  const classes = className ? `card ${className}` : "card";
  return (
    <section className={classes} {...props}>
      {children}
    </section>
  );
}
