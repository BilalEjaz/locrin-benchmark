"use client";
import React, { useState, useEffect } from "react";
import { AnswerButton } from "../ui/AnswerButton";
import { ProgressBar } from "../ui/ProgressBar";
import { Button } from "../ui/Button";
import { useQuiz } from "@/context/QuizContext";
import { useLocale, useTranslations } from "next-intl";
import type { Option } from "@/dictionaries/quizDictionary";
import { trackEvent } from "@/utils/analytics";
import { sendEventToServer } from "@/utils/sendEvent";
import { buildReportPrompt } from "@/utils/buildReportPrompt";

export function QuizScreen() {
  const {
    questions,
    role,
    level,
    currentIndex,
    setCurrentIndex,
    setAnswers,
    answers,
    setStep,
    setReportPromise,
    sanityQuiz,
  } = useQuiz();

  const [inputValue, setInputValue] = useState("");
  const t = useTranslations("QuizScreen");
  const locale = useLocale() || "ua";

  const roleQuestions = questions?.[role as keyof typeof questions] || {};
  let questionList: any[] = [];

  // Добавлено логирование для отладки
  console.log('🔍 Debug QuizScreen:', {
    role,
    level,
    questions,
    roleQuestions,
    hasLevel: level && (roleQuestions as Record<string, any>)[level],
    levelData: level ? (roleQuestions as Record<string, any>)[level] : null
  });

  if (level && (roleQuestions as Record<string, any>)[level]) {
    questionList = (roleQuestions as Record<string, any>)[level];
  } else if ((roleQuestions as Record<string, any>)["all"]) {
    questionList = (roleQuestions as Record<string, any>)["all"];
  }

  console.log('📋 Question list:', questionList, 'length:', questionList.length);

  const current = questionList[currentIndex];

  useEffect(() => {
    if (!current && questionList.length > 0) {
      setStep("form");
    }
  }, [current, questionList.length, setStep]);

  const handleAnswer = async (opt: any) => {
    if (!current) return;

    const answerValue = typeof opt === "string" ? opt : opt.answers[0];
    const questionId = `${currentIndex + 1}`;

    const updatedAnswers = [
      ...answers,
      { question: current.question, answer: answerValue },
    ];

    setAnswers(updatedAnswers);

    const payload = {
      step: "quiz_step_complete",
      step_number: questionId,
      question_text: current.question,
      answer: answerValue,
    };

    trackEvent("quiz_step_complete", payload);
    await sendEventToServer(payload);

    if (currentIndex + 1 < questionList.length) {
      setCurrentIndex(currentIndex + 1);
      setInputValue("");
      return;
    }

    const reportPromise = (async () => {
      try {
        const finalPrompt = await buildReportPrompt({
          sanityQuiz,
          role: role!,
          level: level!,
          answers: updatedAnswers,
          locale: locale as "en" | "ua" | "ru",
        });
        const res = await fetch("/api/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ promptText: finalPrompt }),
        });
        const data = await res.json();

        if (!res.ok) {
          console.error("❌ API error:", data);
          return null;
        }

        return data.report || null;
      } catch (e) {
        console.error("❌ Gemini fetch error:", e);
        return null;
      }
    })();

    setReportPromise(reportPromise);

    const quizCompletePayload = {
      step: "Quiz_complete",
      completion_time: Math.round(performance.now() / 1000),
      user_role: role,
      education_level: level,
    };

    trackEvent("Quiz_complete", quizCompletePayload);
    sendEventToServer(quizCompletePayload);

    setStep("form");
  };

  if (!current) return null;

  return (
    <div className="quiz-container text-[#153060]">
      <div className="flex justify-center">
        <ProgressBar
          current={currentIndex + 1}
          total={questionList.length}
        />
      </div>

      <p className="text-sm mb-4">
        {t("progress", {
          current: currentIndex + 1,
          total: questionList.length,
        })}
      </p>

      <h2 className="text-xl sm:text-2xl font-bold text-left mb-6">
        {current.question}
      </h2>

      {current.type === "multiple-choice" && current.options && (
        <div className="grid grid-cols-1 gap-4">
          {current.options.map((opt: Option, i: number) => (
            <AnswerButton
              key={i}
              className="quiz-option"
              onClick={() => handleAnswer(opt)}
            >
              {opt.answers[0]}
            </AnswerButton>
          ))}
        </div>
      )}

      {current.type === "open-ended" && (
        <div>
          <textarea
            className="w-full p-3 border-2 border-[#C3E5F7] rounded-lg text-base resize-y focus:outline-none focus:ring-[#00C0FD] focus:border-[#00C0FD] bg-gray-50"
            rows={4}
            placeholder={t("placeholder")}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />

          <Button
            className="btn btn-primary w-full sm:w-auto mt-3"
            disabled={inputValue.trim().length < 2}
            onClick={() => handleAnswer(inputValue.trim())}
          >
            {t("buttonNext")}
          </Button>
        </div>
      )}
    </div>
  );
}
