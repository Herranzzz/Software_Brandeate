import type { ReactNode } from "react";


type CardProps = {
  children: ReactNode;
  className?: string;
  id?: string;
};


export function Card({ children, className = "", id }: CardProps) {
  const classes = className ? `card ${className}` : "card";
  return (
    <section className={classes} id={id}>
      {children}
    </section>
  );
}
