"use client";

import { useState } from "react";

export function PasswordInput({ name = "password", autoComplete, label = "Password", hint }: { name?: string; autoComplete: string; label?: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return <label className="lh-field">{label}<span className="lh-password"><input name={name} type={show ? "text" : "password"} autoComplete={autoComplete} minLength={8} required /><button type="button" onClick={() => setShow(!show)} aria-pressed={show}>{show ? "Hide" : "Show"}</button></span>{hint ? <small>{hint}</small> : null}</label>;
}
