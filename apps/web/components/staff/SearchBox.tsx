"use client";

import { useEffect, useState } from "react";
import { IconSearch } from "@tabler/icons-react";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";

type SearchBoxProps = {
  // The search in effect. Key the box on it if something else can change it.
  initial: string;
  onSearch: (q: string) => void;
  placeholder: string;
  className?: string;
};

// A list's search: it waits for a pause in typing before searching.
export function SearchBox({ initial, onSearch, placeholder, className }: SearchBoxProps) {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (value.trim() === initial) return;
    const timer = setTimeout(() => onSearch(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value, initial, onSearch]);

  return (
    <Input
      type="search"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      startAdornment={<IconSearch aria-hidden className="size-4.5" stroke={1.75} />}
      className={cn("w-full sm:w-80", className)}
    />
  );
}
