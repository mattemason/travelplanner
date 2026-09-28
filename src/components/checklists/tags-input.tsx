"use client";

import { useId, useState } from "react";

type Props = { value: string[]; onChange: (next: string[]) => void; suggestions: string[]; label?: string };

/** Free-form tags as removable chips; Enter or comma adds, with suggestions from existing tags. */
export function TagsInput({ value, onChange, suggestions, label = "Tags" }: Props) {
  const [text, setText] = useState("");
  const listId = useId();
  const add = (raw: string) => {
    const tag = raw.trim().replace(/,$/, "").trim();
    if (tag && !value.some((v) => v.toLowerCase() === tag.toLowerCase())) onChange([...value, tag]);
    setText("");
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-[10px] border-[1.5px] border-line bg-soft px-2 py-1.5">
      {value.map((tag) => (
        <span key={tag} className="chip flex items-center gap-1 bg-paper text-ink">
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v !== tag))}
            aria-label={`Remove ${tag}`}
            className="cursor-pointer text-muted"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={text}
        list={listId}
        aria-label={label}
        placeholder={value.length ? "" : "Add a tag, then Enter"}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text.trim() && add(text)}
        className="min-w-[8rem] flex-1 bg-transparent py-1 text-[16px] font-normal text-ink outline-none"
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !value.includes(s))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}
