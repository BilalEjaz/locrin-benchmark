"use client";
import React, { createContext, useContext, useState, useEffect } from "react";
import {
  getQuestions,
  fetchActiveSanityQuiz,
  type QuizSource,
} from "@/services/quizService";
import type { QuestionBankLanguage } from "@/dictionaries/quizDictionary";
import { useLocale } from "next-intl";
import type { Quiz as SanityQuiz } from "@/sanity/lib/types";


export type Answer = {
  question: string;
  answer: string;
  tags?: string[];
};


export type Step = "start" | "role" | "education" | "personalization" | "quiz" | "form" | "thankyou";

type QuizContextType = {
  step: Step;
  setStep: (step: Step) => void;
  role: string | null;
  setRole: (role: string | null) => void;
  level: string | null;
  setLevel: (level: string | null) => void;
  answers: Answer[];
  setAnswers: (answers: Answer[]) => void;
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  currentQuestion: any | null;
  questions: QuestionBankLanguage | null;
  loading: boolean;
  error: string | null;
  reportPromise: Promise<string | null> | null;
  setReportPromise: React.Dispatch<
    React.SetStateAction<Promise<string | null> | null>
  >;
  reportHtml: string | null;
  setReportHtml: React.Dispatch<React.SetStateAction<string | null>>;
  sanityQuiz: SanityQuiz | null;
  setSanityQuiz: React.Dispatch<React.SetStateAction<SanityQuiz | null>>;
  generateReportHtml: (prompt: string) => Promise<string | null>;
};

const QuizContext = createContext<QuizContextType | undefined>(undefined);

interface QuizProviderProps {
  children: React.ReactNode;
  quizSource?: QuizSource;
  sanitySlug?: string;
}

export function QuizProvider({
  children,
  quizSource,
  sanitySlug
}: QuizProviderProps) {
  // Читаем источник данных из env или используем переданный пропс
  const envQuizSource = process.env.NEXT_PUBLIC_QUIZ_SOURCE as QuizSource | undefined;

  // Приоритет: пропсы > env > default "local"
  const finalQuizSource = quizSource || envQuizSource || "local";
  const finalSanitySlug = sanitySlug; // Опциональный, если не задан - берется первый квиз
  const [step, setStep] = useState<Step>("start");
  const [role, setRole] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuestionBankLanguage | null>(null);
  const [reportPromise, setReportPromise] = useState<Promise<string | null> | null>(null);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [sanityQuiz, setSanityQuiz] = useState<SanityQuiz | null>(null);
  

  const locale = useLocale() || "ua";

  useEffect(() => {
    const loadQuizData = async () => {
      setLoading(true);
      setError(null);

      try {
        console.log("🔄 Loading quiz data:", {
          finalQuizSource,
          locale,
          finalSanitySlug,
        });

        if (finalQuizSource === "sanity") {
          const { quiz, data } = await fetchActiveSanityQuiz(
            locale,
            finalSanitySlug
          );
          setSanityQuiz(quiz);
          setQuestions(data);
          console.log("✅ Loaded Sanity quiz + questions:", quiz?.slug?.current);
        } else {
          setSanityQuiz(null);
          const data = await getQuestions(finalQuizSource, locale, finalSanitySlug);
          console.log("✅ Loaded questions data:", data);
          setQuestions(data);
        }
      } catch (err: any) {
        console.error("❌ Failed to load quiz data:", err);
        setError(err.message || "Failed to load quiz data");
      } finally {
        setLoading(false);
      }
    };

    loadQuizData();
  }, [finalQuizSource, locale, finalSanitySlug]);


  const currentQuestion =
    role && level && questions &&
      (questions as any)[role] &&
      (questions as any)[role][level]
      ? (questions as any)[role][level][currentIndex]
      : null;


  const generateReportHtml = (prompt: string) => {
    const promise = fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptText: prompt }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !data.report) {
          console.error("❌ Report API returned error:", data);
          return null;
        }

        const html = typeof data.report === "string" ? data.report : data.report?.report || null;

        setReportHtml(html); // сразу записываем в state
        return html;
      })
      .catch((err) => {
        console.error("❌ Report fetch failed:", err);
        return null;
      });

    setReportPromise(promise); // сохраняем promise в context
    return promise;
  };

  return (
    <QuizContext.Provider
      value={{
        step,
        setStep,
        role,
        setRole,
        level,
        setLevel,
        answers,
        setAnswers,
        currentIndex,
        setCurrentIndex,
        currentQuestion,
        questions,
        loading,
        error,
        reportPromise,
        setReportPromise,
        reportHtml,
        setReportHtml,
        sanityQuiz,
        setSanityQuiz,
        generateReportHtml,
      }}
    >
      {children}
    </QuizContext.Provider>
  );
}

export function useQuiz() {
  const context = useContext(QuizContext);
  if (!context) throw new Error("useQuiz must be used within QuizProvider");
  return context;
}
