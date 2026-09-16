"use client";
import React from "react";
import clsx from "clsx";

type AnswerButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  selected?: boolean;
};

export function AnswerButton({
  children,
  onClick,
  className,
  disabled = false,
  selected = false,
}: AnswerButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={clsx(
        "w-full p-4 text-left font-medium border-2 rounded-[16px] bg-white transition-colors text-[#153060]",
        selected
          ? "border-[#1BACFE] bg-[#EDF9FF]"
          : "border-[#C3E5F7] hover:border-[#1BACFE] hover:bg-[#EDF9FF]",
        disabled && "cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );
}
