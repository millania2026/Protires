import { useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { VEHICLE_CATALOG, VEHICLE_MAKES } from './vehicleCatalog';

function SearchPicker({
  label,
  name,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  label: string;
  name: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const currentText = open ? query : value;
  const filtered = options.filter(item => item.toLocaleLowerCase('es').includes(currentText.toLocaleLowerCase('es')));
  return (
    <label className={'vehiclePicker' + (disabled ? ' isDisabled' : '')}>
      <span>{label}</span>
      <div className="vehiclePickerInput">
        <Search size={15} />
        <input
          name={name}
          value={currentText}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          onFocus={() => {
            setQuery(value);
            setOpen(true);
          }}
          onChange={e => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setOpen(true);
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter' && filtered.length) {
              e.preventDefault();
              onChange(filtered[0]);
              setQuery(filtered[0]);
              setOpen(false);
            }
          }}
        />
        <ChevronDown size={15} />
      </div>
      {open && !disabled && (
        <>
          <button
            type="button"
            className="pickerDismiss"
            aria-label="Cerrar opciones"
            onClick={() => setOpen(false)}
          ></button>
          <div className="vehiclePickerOptions">
            {filtered.slice(0, 80).map(item => (
              <button
                type="button"
                key={item}
                onClick={() => {
                  onChange(item);
                  setQuery(item);
                  setOpen(false);
                }}
              >
                {item}
              </button>
            ))}
            {!filtered.length && <small>Sin sugerencias. Puedes guardar este texto.</small>}
          </div>
        </>
      )}
    </label>
  );
}

export default function VehicleCatalogFields() {
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  return (
    <div className="vehicleCatalogFields">
      <SearchPicker
        label="Marca"
        name="make"
        options={VEHICLE_MAKES}
        value={make}
        placeholder="Buscar o escribir marca…"
        onChange={value => {
          setMake(value);
          setModel('');
        }}
      />
      <SearchPicker
        label="Modelo"
        name="model"
        options={
          VEHICLE_CATALOG[
            VEHICLE_MAKES.find(item => item.toLocaleLowerCase('es') === make.trim().toLocaleLowerCase('es')) || ''
          ] || []
        }
        value={model}
        placeholder={make ? 'Buscar o escribir modelo…' : 'Escribe primero la marca'}
        onChange={setModel}
        disabled={!make.trim()}
      />
    </div>
  );
}
