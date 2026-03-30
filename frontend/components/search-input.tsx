type SearchInputProps = {
  defaultValue?: string;
  name?: string;
  placeholder?: string;
};


export function SearchInput({
  defaultValue = "",
  name = "q",
  placeholder = "Buscar",
}: SearchInputProps) {
  return (
    <div className="field field-search">
      <label htmlFor={name}>Busqueda</label>
      <div className="search-shell">
        <span className="search-icon" aria-hidden="true">
          Buscar
        </span>
        <input
          className="search-input"
          defaultValue={defaultValue}
          id={name}
          name={name}
          placeholder={placeholder}
          type="search"
        />
      </div>
    </div>
  );
}
