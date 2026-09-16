"use client";
import React from "react";
import clsx from "clsx";

type AnswerButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
};

export function AnswerButton({
  children,
  onClick,
  className,
  disabled = false,
}: AnswerButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "w-full p-4 text-left font-medium border-2 rounded-[16px] bg-white transition-colors border-[#C3E5F7] hover:border-[#1BACFE] hover:bg-[#EDF9FF] text-[#153060]",
        disabled && "cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );
}
