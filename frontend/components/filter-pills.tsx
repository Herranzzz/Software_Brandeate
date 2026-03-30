type FilterPill = {
  label: string;
  value: string;
};

type FilterPillsProps = {
  label: string;
  name: string;
  options: FilterPill[];
  selectedValue?: string;
};


export function FilterPills({
  label,
  name,
  options,
  selectedValue = "",
}: FilterPillsProps) {
  return (
    <div className="field pills-field">
      <label>{label}</label>
      <div className="pills-row">
        <input defaultValue={selectedValue} name={name} type="hidden" />
        {options.map((option) => {
          const active = option.value === selectedValue;
          return (
            <button
              className={`pill ${active ? "pill-active" : ""}`}
              formAction={`?${name}=${encodeURIComponent(option.value)}`}
              key={option.value}
              type="submit"
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
