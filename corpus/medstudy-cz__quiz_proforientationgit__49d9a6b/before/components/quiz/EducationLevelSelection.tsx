"use client";
import React from "react";
import { AnswerButton } from "../ui/AnswerButton";
import { useTranslations } from "next-intl";
import { useQuiz } from "@/context/QuizContext";
import { trackEvent } from "@/utils/analytics";
import { sendEventToServer } from "@/utils/sendEvent";

export function EducationLevelSelection() {
  const t = useTranslations("EducationLevelSelection");
  const { questions, role, setLevel, setStep, loading, error } = useQuiz();

  if (loading) return <p>Loading...</p>;
  if (error || !questions || !role) return <p>Error loading questions</p>;

  const studentLevels = ["grade_9", "grade_11", "bachelor"] as const;
  const levels =
    role === "student"
      ? studentLevels.filter(
          (key) =>
            Array.isArray((questions as Record<string, any>)?.student?.[key]) &&
            (questions as Record<string, any>).student[key].length > 0
        )
      : Object.keys((questions as Record<string, any>)?.[role] || {});


  const handleSelect = (level: string) => {
    setLevel(level);
    setStep("personalization");

    const payload = {
      step: "Quiz_start",
      user_role: role,
      education_level: level,
    };

    trackEvent("Quiz_start", payload);
    sendEventToServer(payload);
  };

  return (
    <div className="quiz-container mt-10 mb-10 text-[#153060]">
      <h2 className="mb-6 text-[22px] font-bold">{t(`${role}.title`)}</h2>
      <div className="grid grid-cols-1 gap-4">
        {levels.map((level) => (
          <AnswerButton
            key={level}
            onClick={() => handleSelect(level)}
            className="quiz-option"
          >
            {t(`${role}.options.${level}`)}
          </AnswerButton>
        ))}
      </div>
    </div>
  );
}
