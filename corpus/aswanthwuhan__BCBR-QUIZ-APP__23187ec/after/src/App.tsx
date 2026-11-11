import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { 
  BookOpen, 
  CheckCircle2, 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown,
  History, 
  Layers,
  LayoutDashboard, 
  RotateCcw, 
  Settings, 
  BrainCircuit,
  Info,
  X,
  AlertCircle,
  Trophy,
  GraduationCap,
  Sparkles,
  Moon,
  Sun,
  Flag,
  LogOut,
  Linkedin,
  Coffee,
  WifiOff
} from 'lucide-react';
import { SupportModal } from './components/SupportModal';
import { Modal } from './components/Modal';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { cn } from './lib/utils';
import { ASSIGNMENTS } from './data/questions';
import { Assignment, Question, UserProgress, GlobalState } from './types';
import { getAIExplanation, generateAIQuestions, checkExistingExplanation } from './lib/gemini';
import { addKnownId, removeKnownId, countKnownInIds, isCardDue, scheduleFlashcard, FlashcardGrade } from './lib/flashcards';
import { Flashcards } from './components/Flashcards';
import { REVISION_CARDS, REVISION_DECK_ID, REVISION_DECK_TITLE } from './data/revisionDeck';
import { MODULE_FLASHCARDS, moduleDeckId } from './data/moduleFlashcards';
import { CURATED_FLASHCARDS, curatedDeckId, CURATED_MODULE_TITLES } from './data/curatedFlashcards';
import { PrivacyPolicy, TermsOfService, AboutUs, ContactUs } from './components/Legal';

const SUPPORT_POPUP_INTERVAL_MS = 20 * 60 * 1000;
const SUPPORT_POPUP_SNOOZE_MS = 60 * 60 * 1000;
const SUPPORT_POPUP_LAST_KEY = 'last_support_popup_time';
const SUPPORT_POPUP_SNOOZE_KEY = 'support_popup_snooze_until';

const isSupportPopupSnoozed = () => {
  const until = sessionStorage.getItem(SUPPORT_POPUP_SNOOZE_KEY);
  return !!until && Date.now() < parseInt(until, 10);
};

const markSupportPopupShown = () => {
  sessionStorage.setItem(SUPPORT_POPUP_LAST_KEY, Date.now().toString());
};

// Builds without a backend (Android app, `npm run local`) only offer offline mode
const OFFLINE_ONLY = import.meta.env.VITE_OFFLINE_ONLY === 'true';
const OFFLINE_USERNAME = 'offline';

type View = 'login' | 'dashboard' | 'quiz' | 'review' | 'flashcards' | 'settings' | 'leaderboard' | 'privacy' | 'terms' | 'about' | 'contact';

export default function App() {
  // --- State ---
  const [globalState, setGlobalState] = useState<GlobalState>(() => {
    const defaultState: GlobalState = { progress: {}, version: 2 };
    try {
      const saved = localStorage.getItem('bcbr_state');
      if (!saved) return { ...defaultState, isDarkMode: window.matchMedia('(prefers-color-scheme: dark)').matches };
      
      const parsed = JSON.parse(saved);
      if (parsed.version !== 2) {
        console.log("Version mismatch, resetting state");
        localStorage.removeItem("bcbr_state");
        return { ...defaultState, isDarkMode: window.matchMedia('(prefers-color-scheme: dark)').matches };
      }
      
      if (parsed.isDarkMode === undefined) {
        parsed.isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      return parsed;
    } catch (e) {
      console.error("Error loading state:", e);
      localStorage.removeItem("bcbr_state");
      return { ...defaultState, isDarkMode: window.matchMedia('(prefers-color-scheme: dark)').matches };
    }
  });

  const [view, setView] = useState<View>(globalState.username ? 'dashboard' : 'login');
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null);
  const [pendingAssignmentId, setPendingAssignmentId] = useState<number | null>(null);
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [showDetailedProgress, setShowDetailedProgress] = useState(false);
  const [reviewSessionQuestions, setReviewSessionQuestions] = useState<Question[]>([]);
  const [isGeneratingAIQuestions, setIsGeneratingAIQuestions] = useState(false);
  const [aiGeneratedAssignment, setAiGeneratedAssignment] = useState<Assignment | null>(null);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiAssignmentInput, setAiAssignmentInput] = useState("");
  const [aiModalError, setAiModalError] = useState("");
  const [showResetModal, setShowResetModal] = useState(false);
  const [assignmentToReset, setAssignmentToReset] = useState<number | null>(null);
  const [flashcardDeckId, setFlashcardDeckId] = useState<number | null>(null);
  
  const [sessionAnswers, setSessionAnswers] = useState<Record<number, number>>({});
  const [aiCache, setAiCache] = useState<Record<number, { text: string | null, loading: boolean, detailed: boolean }>>({});
  const [leaderboard, setLeaderboard] = useState<{username: string, score: number, progress?: Record<number, any>}[]>([]);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupFullName, setSignupFullName] = useState("");
  const [signupCollege, setSignupCollege] = useState("");
  const [signupPlace, setSignupPlace] = useState("");
  const [signupQualification, setSignupQualification] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  // Reporting state
  const [showReportModal, setShowReportModal] = useState(false);

  const quizTopRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  // Scroll to the top of the quiz (header row + question + options), keeping it just
  // below the sticky header, whenever the question or view changes in quiz view.
  // The quiz subtree mounts only after the previous view finishes its exit
  // animation (AnimatePresence mode="wait"), so retry for a few frames until the
  // ref exists — otherwise the scroll never happens and the header row can end up
  // hidden behind the sticky header.
  useEffect(() => {
    if (view !== 'quiz') return;

    let frame = 0;
    let attempts = 0;

    const scrollToQuizTop = () => {
      const el = quizTopRef.current;
      if (!el) {
        if (attempts++ < 30) frame = requestAnimationFrame(scrollToQuizTop);
        return;
      }
      const headerOffset = 80;
      const elementPosition = el.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

      window.scrollTo({
        top: Math.max(0, offsetPosition),
        behavior: prefersReducedMotion ? 'auto' : 'smooth'
      });
    };

    scrollToQuizTop();
    return () => cancelAnimationFrame(frame);
  }, [currentQuestionIndex, view]);
  const [reportData, setReportData] = useState<{ questionId?: number | string, assignmentId?: number | string }>({});
  const [reportForm, setReportForm] = useState({ type: 'error', description: '', contact: '' });
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  // Quiz Enhancement state
  const [streak, setStreak] = useState(0);
  const [motivationMsg, setMotivationMsg] = useState<{ text: string, id: number } | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [sessionResults, setSessionResults] = useState<{ correct: number, wrong: number }>({ correct: 0, wrong: 0 });
  const [showAllLeaderboard, setShowAllLeaderboard] = useState(false);

  // New Legal & Feedback state
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [showAIWarningModal, setShowAIWarningModal] = useState(false);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({ type: 'suggestion', message: '', contact: '' });
  const [previousView, setPreviousView] = useState<View | null>(null);
  const [askedForKeyForQId, setAskedForKeyForQId] = useState<number | string | null>(null);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supportModalCompact, setSupportModalCompact] = useState(false);
  const [supportPopupDue, setSupportPopupDue] = useState(false);

  // --- Deep Linking ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view') as View;
    const assignmentParam = params.get('assignment');
    
    if (viewParam && ['login', 'dashboard', 'quiz', 'review', 'flashcards', 'settings', 'leaderboard', 'privacy', 'terms', 'about', 'contact'].includes(viewParam)) {
      // Security: Redirect guests to login if they try to deep-link to protected views
      const isProtected = ['dashboard', 'review', 'flashcards', 'leaderboard'].includes(viewParam);
      if (isProtected && !globalState.username) {
        setView('login');
        return;
      }

      if (viewParam === 'quiz' && assignmentParam) {
        setSelectedAssignmentId(parseInt(assignmentParam));
        setIsReviewMode(false);
        setCurrentQuestionIndex(0);
      }
      setView(viewParam);
    }
  }, [globalState.username]);

  // --- Flashcards ---
  const handleToggleKnownCard = (deckId: number, questionId: string, known: boolean) => {
    setGlobalState(prev => {
      const existing = prev.progress[deckId] || {
        assignmentId: deckId, completedQuestionIds: [], lastQuestionIndex: 0, wrongQuestionIds: []
      };
      const current = existing.knownCardIds || [];
      const next = known ? addKnownId(current, questionId) : removeKnownId(current, questionId);
      return { ...prev, progress: { ...prev.progress, [deckId]: { ...existing, knownCardIds: next } } };
    });
  };

  const handleGradeCard = (deckId: number, cardId: string, grade: FlashcardGrade) => {
    setGlobalState(prev => {
      const existing = prev.progress[deckId] || {
        assignmentId: deckId, completedQuestionIds: [], lastQuestionIndex: 0, wrongQuestionIds: []
      };
      const nextSrs = scheduleFlashcard(existing.cardSrs?.[cardId], grade);
      return { ...prev, progress: { ...prev.progress, [deckId]: { ...existing, cardSrs: { ...(existing.cardSrs || {}), [cardId]: nextSrs } } } };
    });
  };

  // Counts how many of a deck's cards have a due (or never-seen) SRS state.
  const countDueCards = (deckId: number, cardIds: string[]): number => {
    const srs = globalState.progress[deckId]?.cardSrs || {};
    return cardIds.filter(id => isCardDue(srs[id])).length;
  };

  const openFlashcards = (deckId: number | null) => {
    setFlashcardDeckId(deckId);
    setView('flashcards');
  };

  // Initial disclaimer check
  useEffect(() => {
    if (globalState.username && !globalState.hasAcceptedDisclaimer) {
      setShowDisclaimerModal(true);
    }
  }, [globalState.username, globalState.hasAcceptedDisclaimer]);

  // Periodic Support Pop-up Timer (compact card, every 20 minutes of active session).
  useEffect(() => {
    if (!globalState.username) return;

    const interval = setInterval(() => {
      if (isSupportPopupSnoozed()) return;
      const lastShown = sessionStorage.getItem(SUPPORT_POPUP_LAST_KEY);
      const now = Date.now();
      if (!lastShown || now - parseInt(lastShown, 10) > SUPPORT_POPUP_INTERVAL_MS) {
        setSupportPopupDue(true);
      }
    }, SUPPORT_POPUP_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [globalState.username]);

  // Show a due pop-up only when the user is not inside a quiz, so it can never
  // cover the question card, the options or the results screen. A snooze always wins.
  useEffect(() => {
    if (!supportPopupDue || view === 'quiz' || showSupportModal || isSupportPopupSnoozed()) return;
    setSupportPopupDue(false);
    markSupportPopupShown();
    setSupportModalCompact(true);
    setShowSupportModal(true);
  }, [supportPopupDue, view, showSupportModal]);

  // Opening the support card by any route (auto reminder or an explicit click on
  // "Buy Me a Coffee") satisfies the pending reminder, so closing the detailed card
  // never gets immediately followed by a reminder pop-up.
  useEffect(() => {
    if (showSupportModal) setSupportPopupDue(false);
  }, [showSupportModal]);

  // --- Persistence & Sync ---
  useEffect(() => {
    localStorage.setItem('bcbr_state', JSON.stringify(globalState));
  }, [globalState]);

  // Sync to backend if logged in (with debounce)
  useEffect(() => {
    if (!globalState.username || globalState.isOffline) return;
    
    const handler = setTimeout(() => {
      const score = Object.values(globalState.progress).reduce(
        (acc, p) => acc + (p.completedQuestionIds?.length || 0), 0
      );

      fetch('/api/progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          progress: globalState.progress,
          score,
          hasAcceptedDisclaimer: globalState.hasAcceptedDisclaimer,
          hasSeenAIWarning: globalState.hasSeenAIWarning
        })
      })
      .then(res => {
        const ct = res.headers.get('content-type') || '';
        if (!res.ok) {
          if (ct.includes('application/json')) {
            return res.json().then(err => { throw new Error(err.error || 'Server error') });
          }
          return res.text().then(text => { throw new Error(text || 'Server error') });
        }
        if (!ct.includes('application/json')) {
          return res.text().then(text => { throw new Error(text || 'Server error') });
        }
        return res.json();
      })
      .then(() => {
        console.log(`[Sync] Successfully synced progress for ${globalState.username}`);
      })
      .catch(err => {
        console.error(`[Sync] Sync failed for ${globalState.username}:`, err);
      });
    }, 2000);

    return () => clearTimeout(handler);
  }, [globalState.progress, globalState.username, globalState.isOffline, globalState.hasAcceptedDisclaimer, globalState.hasSeenAIWarning]);

  // Apply dark mode class
  useEffect(() => {
    if (globalState.isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [globalState.isDarkMode]);

  // --- Derived Data ---
  const wrongQuestions = useMemo(() => {
    const allWrongIds = Object.values(globalState.progress).flatMap(p => p.wrongQuestionIds);
    const uniqueIds = Array.from(new Set(allWrongIds));
    return ASSIGNMENTS.flatMap(a => a.questions).filter(q => uniqueIds.includes(q.id));
  }, [globalState.progress]);

  const dueQuestions = useMemo(() => {
    if (!globalState.enableSpacedRepetition || !globalState.srsData) return [];
    const now = Date.now();
    const dueIds = Object.entries(globalState.srsData)
      .filter(([_, data]) => data.nextReviewDate <= now)
      .map(([id]) => id);
    return ASSIGNMENTS.flatMap(a => a.questions).filter(q => dueIds.includes(q.id));
  }, [globalState.srsData, globalState.enableSpacedRepetition]);

  // Total flashcards marked "Got it" across the flashcard decks that are shown
  // (revision + curated + per-module facts). Assignment decks are no longer
  // surfaced as flashcards, so they are excluded.
  const totalKnownCards = useMemo(() => {
    const revision = countKnownInIds(
      globalState.progress[REVISION_DECK_ID]?.knownCardIds || [],
      REVISION_CARDS.map(c => c.id)
    );
    const modules = ASSIGNMENTS.reduce((sum, a) => {
      const cards = MODULE_FLASHCARDS[a.id];
      if (!cards) return sum;
      return sum + countKnownInIds(globalState.progress[moduleDeckId(a.id)]?.knownCardIds || [], cards.map(c => c.id));
    }, 0);
    const curated = Object.keys(CURATED_FLASHCARDS).reduce((sum, key) => {
      const id = Number(key);
      const cards = CURATED_FLASHCARDS[id];
      return sum + countKnownInIds(globalState.progress[curatedDeckId(id)]?.knownCardIds || [], cards.map(c => c.id));
    }, 0);
    return revision + modules + curated;
  }, [globalState.progress]);

  const selectedAssignment = useMemo(() => {
    if (isReviewMode) {
      return {
        id: -1,
        title: globalState.enableSpacedRepetition ? "Spaced Repetition" : "Mistake QBank",
        questions: reviewSessionQuestions
      } as Assignment;
    }
    if (aiGeneratedAssignment && selectedAssignmentId === aiGeneratedAssignment.id) {
      return aiGeneratedAssignment;
    }
    return ASSIGNMENTS.find(a => a.id === selectedAssignmentId);
  }, [selectedAssignmentId, isReviewMode, reviewSessionQuestions, globalState.enableSpacedRepetition, aiGeneratedAssignment]);

  const globalProgress = useMemo(() => {
    const totalQuestions = ASSIGNMENTS.reduce((acc, a) => acc + a.questions.length, 0);
    if (totalQuestions === 0) return 0;
      const score = Object.values(globalState.progress).reduce(
        (acc, p) => acc + (p.completedQuestionIds?.length || 0), 0
      );
    return Math.round((score / totalQuestions) * 100);
  }, [globalState.progress]);

  // --- Handlers ---

  const closeSupportModal = () => {
    setShowSupportModal(false);
    setSupportModalCompact(false);
  };

  // Dismissing the auto pop-up (X / backdrop / "Maybe later") silences it for an hour.
  const snoozeSupportPopup = () => {
    sessionStorage.setItem(SUPPORT_POPUP_SNOOZE_KEY, (Date.now() + SUPPORT_POPUP_SNOOZE_MS).toString());
    markSupportPopupShown();
    setSupportPopupDue(false);
    closeSupportModal();
  };

  const handleAIQBankClick = () => {
    if (!globalState.apiKey) {
      setView('settings');
      return;
    }
    setAiModalError("");
    setAiAssignmentInput("");
    setShowAIModal(true);
  };

  const handleGenerateAIQuestions = async () => {
    if (!globalState.apiKey) {
      setAiModalError("API Key Missing. Add it in Settings (gear icon).");
      return;
    }

    const assignmentNum = parseInt(aiAssignmentInput, 10);
    if (isNaN(assignmentNum)) {
      setAiModalError("Please enter a valid assignment number.");
      return;
    }

    const assignment = ASSIGNMENTS.find(a => a.id === assignmentNum);
    if (!assignment) {
      setAiModalError(`Assignment ${assignmentNum} not found.`);
      return;
    }

    setShowAIModal(false);
    setIsGeneratingAIQuestions(true);
    setAiModalError("");

    try {
      const questions = await generateAIQuestions(assignment.title, globalState.apiKey);
      const newAssignmentId = 1000 + assignmentNum;
      const newAssignment: Assignment = {
        id: newAssignmentId,
        title: `AI QBank: ${assignment.title}`,
        questions
      };
      setAiGeneratedAssignment(newAssignment);
      setAskedForKeyForQId(null);
      setSelectedAssignmentId(newAssignmentId);
      setIsReviewMode(false);
      setCurrentQuestionIndex(0);
      setView('quiz');
    } catch (err: any) {
      console.error("AI Generation Error:", err);
      let errMsg = err.message || "Failed to generate questions.";
      if (errMsg.includes("AUTH_ERROR")) {
        errMsg = "Invalid API Key. Please check your Gemini key in Settings.";
      } else if (errMsg.includes("QUOTA_ERROR")) {
        errMsg = "AI Limit reached for this minute. Please wait 60 seconds.";
      } else {
        errMsg = errMsg.replace("CONNECTION_ERROR: ", "");
      }
      setAiModalError(errMsg);
      setShowAIModal(true);
    } finally {
      setIsGeneratingAIQuestions(false);
    }
  };

  const calculateNextSRS = (current: { interval: number, easeFactor: number, repetitions: number } | undefined, isCorrect: boolean) => {
    const quality = isCorrect ? 4 : 1;
    let { interval, easeFactor, repetitions } = current || { interval: 0, easeFactor: 2.5, repetitions: 0 };

    if (quality >= 3) {
      if (repetitions === 0) interval = 1;
      else if (repetitions === 1) interval = 6;
      else interval = Math.round(interval * easeFactor);
      repetitions += 1;
    } else {
      repetitions = 0;
      interval = 1;
    }

    easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3;

    const nextReviewDate = Date.now() + interval * 24 * 60 * 60 * 1000;

    return { interval, easeFactor, repetitions, nextReviewDate };
  };

  const handleStartAssignment = (id: number) => {
    const progress = globalState.progress[id];
    if (progress && progress.lastQuestionIndex > 0) {
      setPendingAssignmentId(id);
      return;
    }

    setAskedForKeyForQId(null);
    setSelectedAssignmentId(id);
    setIsReviewMode(false);
    setCurrentQuestionIndex(0);
    setView('quiz');
  };

  const executeContinueAssignment = () => {
    if (pendingAssignmentId === null) return;
    const progress = globalState.progress[pendingAssignmentId];
    setAskedForKeyForQId(null);
    setSelectedAssignmentId(pendingAssignmentId);
    setIsReviewMode(false);
    setCurrentQuestionIndex(progress?.lastQuestionIndex || 0);
    setView('quiz');
    setPendingAssignmentId(null);
  };

  const executeRestartAssignmentFromPending = (id?: any) => {
    const targetId = typeof id === 'number' ? id : pendingAssignmentId;
    if (targetId === null) return;
    
    setGlobalState(prev => {
      const nextProgress = { ...prev.progress };
      delete nextProgress[targetId];
      return { ...prev, progress: nextProgress };
    });
    
    setSessionAnswers({});
    setAskedForKeyForQId(null);
    setSelectedAssignmentId(targetId);
    setIsReviewMode(false);
    setCurrentQuestionIndex(0);
    setView('quiz');
    setPendingAssignmentId(null);
  };

  const handleStartReviewQuiz = (startIndex = 0) => {
    if (wrongQuestions.length === 0) return;
    setSessionAnswers(prev => {
      const next = { ...prev };
      wrongQuestions.forEach(q => delete next[q.id]);
      return next;
    });
    setAskedForKeyForQId(null);
    setReviewSessionQuestions(wrongQuestions);
    setIsReviewMode(true);
    setSelectedAssignmentId(null);
    setCurrentQuestionIndex(startIndex);
    setView('quiz');
  };

  const handleReturnToDashboard = () => {
    setShowResults(false);
    setAskedForKeyForQId(null);
    if (!globalState.username) {
      setView('login');
    } else {
      setView('dashboard');
    }
    setSelectedAssignmentId(null);
    setSessionAnswers({});
    setStreak(0);
    setSessionResults({ correct: 0, wrong: 0 });
  };

  const handleOptionSelect = (index: number) => {
    const question = selectedAssignment!.questions[currentQuestionIndex];
    if (sessionAnswers[question.id] !== undefined) return;

    setSessionAnswers(prev => ({ ...prev, [question.id]: index }));

    const isCorrect = index === question.correctAnswer;
    
    // Track stats for results and streaks
    if (isCorrect) {
      setStreak(prev => prev + 1);
      setSessionResults(prev => ({ ...prev, correct: prev.correct + 1 }));
      
      const newStreak = streak + 1;
      const messages = [
        { count: 3, text: "You are good at this! 🔥" },
        { count: 5, text: "You are a champion! 🏆" },
        { count: 10, text: "You are born for this! ✨" },
        { count: 15, text: "Absolute Genius! 🧠" },
        { count: 20, text: "Unstoppable Force! ⚡" }
      ];
      
      const msg = messages.find(m => m.count === newStreak);
      if (msg) {
        setMotivationMsg({ text: msg.text, id: Date.now() });
        setTimeout(() => setMotivationMsg(null), 3000);
      }
    } else {
      setStreak(0);
      setSessionResults(prev => ({ ...prev, wrong: prev.wrong + 1 }));
    }

    // Find which assignment this question belongs to (for review mode)
    const assignmentId = isReviewMode 
      ? ASSIGNMENTS.find(a => a.questions.some(q => q.id === question.id))?.id
      : selectedAssignmentId;

    if (!assignmentId) return;

    setGlobalState(prev => {
      const currentProgress = prev.progress[assignmentId] || {
        assignmentId: assignmentId,
        completedQuestionIds: [],
        lastQuestionIndex: 0,
        wrongQuestionIds: []
      };

      const newCompleted = isCorrect 
        ? Array.from(new Set([...currentProgress.completedQuestionIds, question.id]))
        : currentProgress.completedQuestionIds.filter(id => id !== question.id);
        
      const newWrong = isCorrect 
        ? currentProgress.wrongQuestionIds.filter(id => id !== question.id)
        : Array.from(new Set([...currentProgress.wrongQuestionIds, question.id]));

      const newSrsData = prev.enableSpacedRepetition 
        ? {
            ...prev.srsData,
            [question.id]: calculateNextSRS(prev.srsData?.[question.id], isCorrect)
          }
        : prev.srsData;

      return {
        ...prev,
        srsData: newSrsData,
        progress: {
          ...prev.progress,
          [assignmentId]: {
            ...currentProgress,
            completedQuestionIds: newCompleted,
            wrongQuestionIds: newWrong,
            selectedAnswers: { ...currentProgress.selectedAnswers, [question.id]: index },
            lastQuestionIndex: isReviewMode ? currentProgress.lastQuestionIndex : currentQuestionIndex
          }
        }
      };
    });

    autoFetchExplanation(question);
  };

  const handleSkip = () => {
    const question = selectedAssignment!.questions[currentQuestionIndex];
    if (sessionAnswers[question.id] !== undefined) return;

    setSessionAnswers(prev => ({ ...prev, [question.id]: -1 }));
    setStreak(0);
    setSessionResults(prev => ({ ...prev, wrong: prev.wrong + 1 }));

    const assignmentId = isReviewMode 
      ? ASSIGNMENTS.find(a => a.questions.some(q => q.id === question.id))?.id
      : selectedAssignmentId;

    if (!assignmentId) return;

    setGlobalState(prev => {
      const currentProgress = prev.progress[assignmentId] || {
        assignmentId: assignmentId,
        completedQuestionIds: [],
        lastQuestionIndex: 0,
        wrongQuestionIds: []
      };

      const newWrong = Array.from(new Set([...currentProgress.wrongQuestionIds, question.id]));

      return {
        ...prev,
        progress: {
          ...prev.progress,
          [assignmentId]: {
            ...currentProgress,
            wrongQuestionIds: newWrong,
            selectedAnswers: { ...currentProgress.selectedAnswers, [question.id]: -1 },
            lastQuestionIndex: isReviewMode ? currentProgress.lastQuestionIndex : currentQuestionIndex
          }
        }
      };
    });

    autoFetchExplanation(question);
  };

  const handleNext = () => {
    if (!selectedAssignment) return;
    if (currentQuestionIndex < selectedAssignment.questions.length - 1) {
      const nextIdx = currentQuestionIndex + 1;
      setAskedForKeyForQId(null);
      setCurrentQuestionIndex(nextIdx);
      
      // Update last seen index
      if (!isReviewMode && selectedAssignmentId) {
        setGlobalState(prev => ({
          ...prev,
          progress: {
            ...prev.progress,
            [selectedAssignmentId]: {
              ...prev.progress[selectedAssignmentId],
              lastQuestionIndex: nextIdx
            }
          }
        }));
      }
    } else {
      // Show the results right away — the support pop-up is never allowed to cover them.
      setShowResults(true);
    }
  };

  const handlePrev = () => {
    if (currentQuestionIndex > 0) {
      setAskedForKeyForQId(null);
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const autoFetchExplanation = async (question: Question) => {
    if (aiCache[question.id]?.text || aiCache[question.id]?.loading) return;
    
    try {
      const cached = await checkExistingExplanation(question.text, false);
      if (cached) {
        setAiCache(prev => ({
          ...prev,
          [question.id]: { text: cached, loading: false, detailed: false }
        }));
      }
    } catch (err) {
      console.error("[Auto-fetch] Cache check failed:", err);
    }
  };

  const handleAiExplain = async (detailed = false) => {
    const question = selectedAssignment?.questions[currentQuestionIndex];
    if (!question) return;
    const qId = question.id;

    if (!globalState.apiKey) {
      setAskedForKeyForQId(qId);
      return;
    }

    // Show AI warning if not seen before
    if (!globalState.hasSeenAIWarning) {
      setShowAIWarningModal(true);
      return;
    }

    setAiCache(prev => ({
      ...prev,
      [qId]: { ...prev[qId], loading: true, detailed }
    }));

    try {
      const explanation = await getAIExplanation(
        question.text,
        question.options,
        question.options[question.correctAnswer],
        question.explanation,
        globalState.apiKey,
        detailed
      );
      setAiCache(prev => ({
        ...prev,
        [qId]: { text: explanation, loading: false, detailed }
      }));
    } catch (err: any) {
      console.error("Explanation error caught in UI:", err);
      const errMsg = err.message || "Connection lost.";
      setAiCache(prev => ({
        ...prev,
        [qId]: { 
          text: errMsg.includes("AUTH_ERROR") ? "Error: Invalid API Key. Fix in Settings." : `Error: ${errMsg}`, 
          loading: false, 
          detailed: false 
        }
      }));
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    if (!loginUsername.trim() || !loginPassword.trim()) {
      setLoginError("Both username and password are required.");
      return;
    }
    
    setIsLoggingIn(true);
    try {
      const endpoint = isSignUp ? '/api/signup' : '/api/login';
      const payload = isSignUp 
        ? { 
            username: loginUsername.trim(), 
            password: loginPassword,
            fullName: signupFullName.trim(),
            college: signupCollege.trim(),
            place: signupPlace.trim(),
            qualification: signupQualification.trim(),
            email: signupEmail.trim() || undefined
          }
        : { username: loginUsername.trim(), password: loginPassword };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const contentType = res.headers.get('content-type') || '';
      let data: any;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        if (!res.ok) throw new Error(text || "Failed to authenticate");
        throw new Error("Unexpected server response");
      }
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to authenticate");
      }
      
      setGlobalState(prev => ({
        ...prev,
        version: 2,
        username: data.username,
        fullName: data.fullName,
        college: data.college,
        place: data.place,
        qualification: data.qualification,
        email: data.email,
        hasAcceptedDisclaimer: data.hasAcceptedDisclaimer || prev.hasAcceptedDisclaimer,
        hasSeenAIWarning: data.hasSeenAIWarning || prev.hasSeenAIWarning,
        progress: Object.keys(data.progress || {}).length > 0 ? data.progress : prev.progress
      }));
      setView('dashboard');
    } catch (err: any) {
      console.error("Auth failed:", err);
      setLoginError(err.message || "Failed to connect to server. Check your network.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const startOfflineMode = () => {
    setLoginError("");
    setGlobalState(prev => ({ ...prev, version: 2, username: OFFLINE_USERNAME, isOffline: true }));
    setView('dashboard');
  };

  const handleLogout = async () => {
    if (globalState.isOffline) {
      // Leaving offline mode keeps on-device progress (it carries over if they log in)
      setAskedForKeyForQId(null);
      setGlobalState(prev => ({ ...prev, username: undefined, isOffline: false }));
      setView('login');
      return;
    }
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch { /* ignore — cookie cleared server-side even if network fails */ }
    setAskedForKeyForQId(null);
    setGlobalState(prev => ({ 
      version: 2,
      progress: {}, 
      apiKey: prev.apiKey, 
      isDarkMode: prev.isDarkMode 
    }));
    setView('login');
    setLoginUsername("");
    setLoginPassword("");
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackForm.message.trim()) return;
    const contact = feedbackForm.contact.trim();
    if (!contact) return;
    if (globalState.isOffline) {
      alert("Sending feedback needs an online account. Please log in on the website, or email connection249@gmail.com.");
      return;
    }

    setIsSubmittingFeedback(true);
    setFeedbackSuccess(false);

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: feedbackForm.type,
          message: feedbackForm.message.trim(),
          contact
        })
      });

      if (res.ok) {
        setFeedbackSuccess(true);
        setFeedbackForm(prev => ({ ...prev, message: '', contact: '' }));
        setTimeout(() => setFeedbackSuccess(false), 3000);
      }
    } catch (err) {
      console.error("Feedback failed:", err);
      alert("Failed to send feedback.");
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const loadLeaderboard = async () => {
    try {
      const res = await fetch('/api/leaderboard');
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !ct.includes('application/json')) {
        const text = await res.text();
        throw new Error(text || "Server error");
      }
      const data = await res.json();
      setLeaderboard(data);
      setView('leaderboard');
    } catch (err) {
      console.error("Failed to load leaderboard:", err);
      alert("Could not load leaderboard.");
    }
  };

  const confirmResetProgress = () => {
    setShowResetModal(true);
  };

  const executeResetProgress = () => {
    // Clear study progress only; keep the account, settings and accepted disclaimers
    setGlobalState(prev => ({ ...prev, version: 2, progress: {}, srsData: {} }));
    setSessionAnswers({});
    setSessionResults({ correct: 0, wrong: 0 });
    setStreak(0);
    setAiCache({});
    localStorage.removeItem('bcbr_state');
    setShowResetModal(false);
  };

  const handleResetAssignment = (id: number) => {
    setAssignmentToReset(id);
  };

  const executeResetAssignment = () => {
    if (assignmentToReset === null) return;
    
    setGlobalState(prev => {
      const nextProgress = { ...prev.progress };
      delete nextProgress[assignmentToReset];
      return { ...prev, progress: nextProgress };
    });

    // Clear answers and reset session results for this assignment
    const assignment = ASSIGNMENTS.find(a => a.id === assignmentToReset);
    if (assignment) {
      setSessionAnswers(prev => {
        const next = { ...prev };
        assignment.questions.forEach(q => delete next[q.id]);
        return next;
      });
      // If we are resetting the assignment we were just doing, clear the totals
      if (selectedAssignmentId === assignmentToReset) {
        setSessionResults({ correct: 0, wrong: 0 });
        setStreak(0);
      }
    }

    setAssignmentToReset(null);
  };

  const handleReportSubmit = async () => {
    if (!globalState.username) return;
    const contact = reportForm.contact.trim();
    if (!contact) return;
    if (globalState.isOffline) {
      alert("Reporting a question needs an online account. Please log in on the website, or email connection249@gmail.com.");
      return;
    }
    setIsSubmittingReport(true);
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question_id: reportData.questionId,
          assignment_id: reportData.assignmentId,
          report_type: reportForm.type,
          description: reportForm.description,
          contact
        })
      });
      if (res.ok) {
        setShowReportModal(false);
        setReportForm({ type: 'error', description: '', contact: '' });
        alert("Report submitted successfully. Thank you!");
      } else {
        throw new Error("Failed to submit report");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to submit report. Please try again later.");
    } finally {
      setIsSubmittingReport(false);
    }
  };

  // --- UI Components ---
  const ProgressBar = ({ value, className, color = "bg-sky-500" }: { value: number, className?: string, color?: string }) => (
    <div className={cn("w-full bg-sky-100/30 rounded-full h-2 overflow-hidden backdrop-blur-sm", className)}>
      <motion.div 
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        className={cn("h-full shadow-[0_0_10px_rgba(14,165,233,0.5)]", color)}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F0F9FF] dark:bg-slate-950 text-[#0F172A] dark:text-slate-100 font-sans selection:bg-sky-200 dark:selection:bg-sky-900 selection:text-slate-900 dark:selection:text-slate-100 transition-colors duration-300">
      {/* Futuristic Background Elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <motion.div 
          animate={prefersReducedMotion ? undefined : { 
            scale: [1, 1.2, 1],
            x: [0, 50, 0],
            y: [0, 30, 0]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-sky-200/40 blur-[120px] rounded-full" 
        />
        <motion.div 
          animate={prefersReducedMotion ? undefined : { 
            scale: [1, 1.1, 1],
            x: [0, -30, 0],
            y: [0, 50, 0]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-200/40 dark:bg-indigo-900/40 blur-[120px] rounded-full" 
        />
        <motion.div 
          animate={prefersReducedMotion ? undefined : { 
            scale: [1, 1.3, 1],
            opacity: [0.3, 0.5, 0.3]
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className="absolute top-[20%] right-[10%] w-[20%] h-[20%] bg-cyan-200/30 dark:bg-cyan-900/30 blur-[100px] rounded-full" 
        />
      </div>

      {/* Navigation Rail / Header */}
      <header className="sticky top-0 z-40 bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border-b border-sky-100/50 dark:border-slate-800/50 px-2 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-y-2 shadow-sm">
        <div className="flex items-center gap-2 sm:gap-3 cursor-pointer" onClick={() => setView(globalState.username ? 'dashboard' : 'login')}>
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-sky-500 to-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-sky-200/50 dark:shadow-sky-900/20">
            <GraduationCap size={20} className="sm:hidden" />
            <GraduationCap size={24} className="hidden sm:block" />
          </div>
          <div>
            <h1 className="font-bold text-base sm:text-lg tracking-tight bg-gradient-to-r from-sky-600 to-indigo-600 dark:from-sky-400 dark:to-indigo-400 bg-clip-text text-transparent">BCBR QBANK</h1>
            <p className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500 flex items-center gap-1">
              By Dr Aswanth <a href="https://www.linkedin.com/in/draswanth/" target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-0.5 font-bold">
                <Linkedin size={12} className="text-[#0A66C2]" /> <span className="text-orange-600 dark:text-orange-500 hover:text-orange-700 transition-colors">(Click to add me on LinkedIn)</span>
              </a>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1 sm:gap-4">
          <button
            onClick={() => setShowSupportModal(true)}
            className="flex items-center gap-1.5 p-2 rounded-lg hover:bg-amber-50/50 dark:hover:bg-amber-950/20 text-amber-600 dark:text-amber-500 hover:text-amber-700 transition-all font-sans"
            title="Support the Creator"
          >
            <Coffee size={20} className="animate-pulse" />
            <span className="hidden md:inline text-xs font-bold uppercase tracking-wider">Buy Me a Coffee</span>
          </button>

          <button
            onClick={() => setGlobalState(prev => ({ ...prev,  isDarkMode: !prev.isDarkMode }))}
            className="p-2 rounded-lg hover:bg-sky-100/50 dark:hover:bg-slate-800/50 text-sky-600 dark:text-sky-400 transition-all"
            title={globalState.isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {globalState.isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>

          {globalState.username && (
            <button 
              onClick={() => openFlashcards(null)}
              className={cn(
                "p-2 rounded-lg transition-all",
                view === 'flashcards' ? "bg-sky-500 text-white shadow-lg shadow-sky-200 dark:shadow-sky-900" : "hover:bg-sky-100/50 dark:hover:bg-slate-800/50 text-sky-600 dark:text-sky-400"
              )}
              title="Flashcards"
            >
              <Layers size={20} />
            </button>
          )}

          {globalState.username && !globalState.isOffline && (
            <button
              onClick={loadLeaderboard}
              className={cn(
                "p-2 rounded-lg transition-all",
                view === 'leaderboard' ? "bg-sky-500 text-white shadow-lg shadow-sky-200 dark:shadow-sky-900" : "hover:bg-sky-100/50 dark:hover:bg-slate-800/50 text-sky-600 dark:text-sky-400"
              )}
            >
              <Trophy size={20} />
            </button>
          )}
          <button 
            onClick={() => {
              setPreviousView(view);
              setView('settings');
            }}
            className={cn(
              "p-2 rounded-lg transition-all",
              view === 'settings' ? "bg-sky-500 text-white shadow-lg shadow-sky-200 dark:shadow-sky-900" : "hover:bg-sky-100/50 dark:hover:bg-slate-800/50 text-sky-600 dark:text-sky-400"
            )}
          >
            <Settings size={20} />
          </button>
          
          {globalState.username && (
            <button 
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-all"
              title={globalState.isOffline ? "Exit offline mode" : "Log Out"}
            >
              <LogOut size={20} />
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 sm:p-6 relative z-10">
        <AnimatePresence mode="wait">
          {view === 'login' && (
            <motion.div 
              key="login"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-md mx-auto mt-20"
            >
              <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-3xl p-8 shadow-2xl shadow-sky-100/50 dark:shadow-slate-950 border border-white dark:border-slate-800 text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-sky-500 to-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-sky-200/50 dark:shadow-sky-900/20 mx-auto mb-6">
                  <GraduationCap size={32} />
                </div>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">Free BCBR Prep & QBank</h2>
                <p className="text-slate-500 dark:text-slate-400 mb-3 text-sm leading-relaxed">
                  {OFFLINE_ONLY
                    ? "1000+ BCBR past year questions — completely free, no account needed."
                    : isSignUp ? "Create a free account to save your progress." : "1000+ BCBR past year questions — completely free. Log in to start your BCBR preparation."}
                </p>
                <div className="flex flex-wrap justify-center gap-2 mb-6">
                  {['Past Year Questions', 'Free QBank', '23 Assignments', 'AI Explanations'].map(tag => (
                    <span key={tag} className="text-[10px] font-bold uppercase tracking-wider bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 px-2.5 py-1 rounded-full border border-sky-100 dark:border-sky-800/50">{tag}</span>
                  ))}
                </div>

                {!OFFLINE_ONLY && (<>
                {loginError && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-xl mb-6 text-sm flex items-center gap-2 text-left">
                    <AlertCircle size={16} className="shrink-0" />
                    <span>{loginError}</span>
                  </div>
                )}
                
                <form onSubmit={handleLogin} className="space-y-4">
                  <input
                    type="text"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="Enter username..."
                    aria-label="Enter username..."
                    className="w-full bg-white/50 dark:bg-slate-800/50 border border-sky-100 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
                    required
                  />
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter password..."
                    aria-label="Enter password..."
                    className="w-full bg-white/50 dark:bg-slate-800/50 border border-sky-100 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
                    required
                  />
                  {isSignUp && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="space-y-4 overflow-hidden"
                    >
                      <input
                        type="text"
                        value={signupFullName}
                        onChange={(e) => setSignupFullName(e.target.value)}
                        placeholder="Full Name (Required)"
                        aria-label="Full Name (Required)"
                        className="w-full bg-white/50 dark:bg-slate-800/50 border border-sky-100 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
                        required
                      />
                      <input
                        type="text"
                        value={signupCollege}
                        onChange={(e) => setSignupCollege(e.target.value)}
                        placeholder="College Name (Required)"
                        aria-label="College Name (Required)"
                        className="w-full bg-white/50 dark:bg-slate-800/50 border border-sky-100 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
                        required
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <input
                          type="text"
                          value={signupPlace}
                          onChange={(e) => setSignupPlace(e.target.value)}
                          placeholder="Place"
                          aria-label="Place"
                          className="w-full bg-white/50 dark:bg-slate-800/50 border border-sky-100 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
                          required
                        />
                        <input
                          type="text"
                          value={signupQualification}
                          onChange={(e) => setSignupQualification(e.target.value)}
                          placeholder="Educational Qualification"
                          aria-label="Educational Qualification"
                          className="w-full bg-white/50 dark:bg-slate-800/50 border border-sky-100 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
                          required
                        />
                      </div>
                      <input
                        type="email"
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                        placeholder="Email ID (Optional)"
                        aria-label="Email ID (Optional)"
                        className="w-full bg-white/50 dark:bg-slate-800/50 border border-sky-100 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
                      />
                    </motion.div>
                  )}
                  <button
                    type="submit"
                    disabled={isLoggingIn || !loginUsername.trim() || !loginPassword.trim()}
                    className="w-full bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold py-3 rounded-xl shadow-lg shadow-sky-200 hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isLoggingIn ? (
                      <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    ) : (
                      isSignUp ? "Create Account" : "Log In"
                    )}
                  </button>
                </form>

                <div className="mt-6 text-sm text-slate-500">
                  {isSignUp ? "Already have an account?" : "Need an account?"}{" "}
                  <button 
                    onClick={() => { setIsSignUp(!isSignUp); setLoginError(""); }}
                    className="font-bold text-sky-600 hover:text-sky-700 hover:underline"
                  >
                    {isSignUp ? "Log In" : "Sign Up"}
                  </button>
                </div>
                </>)}

                <div className={cn("space-y-3", !OFFLINE_ONLY && "mt-8 pt-6 border-t border-slate-100 dark:border-slate-800")}>
                  <button
                    onClick={startOfflineMode}
                    className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl font-bold shadow-lg shadow-emerald-200/50 dark:shadow-emerald-900/20 hover:opacity-90 transition-all flex items-center justify-center gap-2"
                  >
                    <WifiOff size={18} />
                    {OFFLINE_ONLY ? "Start Studying" : "Use Offline (No Account)"}
                  </button>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    All questions and flashcards work without internet. Progress is saved on this device only.
                  </p>
                  {!OFFLINE_ONLY && <button
                    onClick={() => {
                      setAskedForKeyForQId(null);
                      setSelectedAssignmentId(1);
                      setIsReviewMode(false);
                      setCurrentQuestionIndex(0);
                      setView('quiz');
                    }}
                    className="w-full py-3 bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400 rounded-xl font-bold hover:bg-sky-100 dark:hover:bg-sky-900/30 transition-all flex items-center justify-center gap-2"
                  >
                    <Sparkles size={18} />
                    Try Free BCBR Past Year Questions (No Login)
                  </button>}
                </div>
              </div>


            </motion.div>
          )}

          {view === 'privacy' && <PrivacyPolicy key="privacy" onBack={() => setView(globalState.username ? 'dashboard' : 'login')} />}
          {view === 'terms' && <TermsOfService key="terms" onBack={() => setView(globalState.username ? 'dashboard' : 'login')} />}
          {view === 'about' && <AboutUs key="about" onBack={() => setView(globalState.username ? 'dashboard' : 'login')} />}
          {view === 'contact' && <ContactUs key="contact" onBack={() => setView(globalState.username ? 'dashboard' : 'login')} />}

          {view === 'leaderboard' && globalState.username && (
            <motion.div 
              key="leaderboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <Trophy className="text-sky-500 dark:text-sky-400" size={28} />
                  <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Global Leaderboard</h2>
                </div>
                {leaderboard.length > 10 && (
                  <button 
                    onClick={() => setShowAllLeaderboard(!showAllLeaderboard)}
                    className="text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline"
                  >
                    {showAllLeaderboard ? "Show Top 10" : "View All"}
                  </button>
                )}
              </div>

              <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-3xl p-6 shadow-2xl shadow-sky-100/50 dark:shadow-slate-950 border border-white dark:border-slate-800">
                {leaderboard.length === 0 ? (
                  <p className="text-center text-slate-500 py-8">No data available yet.</p>
                ) : (
                  <div className="space-y-4">
                    <div className="p-4 bg-sky-50/30 dark:bg-sky-900/10 rounded-2xl border border-sky-100/30 dark:border-sky-800/20 mb-6">
                      <div className="flex items-center gap-2 text-sky-700 dark:text-sky-300 mb-2">
                        <Info size={16} />
                        <h4 className="font-bold text-xs uppercase tracking-widest">How Points are Calculated</h4>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        Earn <span className="font-bold text-sky-600 dark:text-sky-400">1 Point</span> for every unique question you answer correctly. Your total points reflect your mastery across all assignments.
                      </p>
                    </div>

                    {leaderboard.slice(0, showAllLeaderboard ? undefined : 10).map((user, idx) => (
                      <div key={`leaderboard-item-${user.username}-${idx}`} className="flex items-center justify-between p-4 rounded-2xl bg-sky-50/50 dark:bg-slate-800/40 border border-sky-100/50 dark:border-slate-700/50 hover:bg-white dark:hover:bg-slate-800 transition-all group">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm",
                            idx === 0 ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400" :
                            idx === 1 ? "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300" :
                            idx === 2 ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400" :
                            "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400"
                          )}>
                            {idx + 1}
                          </div>
                          <div>
                            <div className="font-bold text-slate-700 dark:text-slate-200">{user.username}</div>
                            {(() => { 
                              const totalQ = ASSIGNMENTS.reduce((acc: number, a: any) => acc + a.questions.length, 0); 
                              const prog = user.progress || {}; 
                              const correct = Object.values(prog).reduce((acc: number, p: any) => acc + (p.completedQuestionIds?.length || 0), 0); 
                              const pct = totalQ > 0 ? Math.round((correct / totalQ) * 100) : 0; 
                              return <div className="text-[9px] font-bold text-sky-500 dark:text-sky-400">{pct}% Mastered</div>; 
                            })()}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="font-black text-xl text-sky-600 dark:text-sky-400">{user.score || 0}</span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-1 uppercase font-bold tracking-widest">Points</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>


            </motion.div>
          )}

          {view === 'dashboard' && globalState.username && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6 sm:space-y-8"
            >
              {/* Global Progress Card */}
              <div 
                onClick={() => setShowDetailedProgress(!showDetailedProgress)}
                className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-3xl p-6 sm:p-8 shadow-xl shadow-sky-100/50 dark:shadow-slate-950 border border-white/50 dark:border-slate-800/50 relative overflow-hidden cursor-pointer group hover:bg-white/80 dark:hover:bg-slate-900/80 transition-all"
              >
                <div className="relative z-10">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-4 gap-2">
                    <div>
                      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-800 dark:text-slate-100">Welcome back, Researcher</h2>
                      <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm sm:text-base">Your overall exam preparation progress</p>
                    </div>
                    <div className="text-left sm:text-right">
                      <span className="text-3xl sm:text-4xl font-black text-sky-600 dark:text-sky-400">{globalProgress}%</span>
                    </div>
                  </div>
                  <ProgressBar value={globalProgress} className="h-4" color="bg-gradient-to-r from-sky-400 to-indigo-500" />
                  
                  <AnimatePresence>
                    {showDetailedProgress && (
                      <motion.div 
                        key="detailed-progress"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-8 pt-8 border-t border-sky-100/50 space-y-4 overflow-hidden"
                      >
                        <h3 className="text-xs uppercase tracking-widest font-bold text-sky-600 dark:text-sky-400 mb-4">Assignment Breakdown</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                          {ASSIGNMENTS.map(a => {
                            const prog = globalState.progress[a.id];
                            const comp = Object.keys(prog?.selectedAnswers || {}).length;
                            const tot = a.questions.length;
                            const perc = Math.round((comp / tot) * 100);
                            return (
                              <div key={a.id} className="space-y-1">
                                <div className="flex justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                  <span className="truncate max-w-[150px]">{a.title}</span>
                                  <span>{perc}%</span>
                                </div>
                                <ProgressBar value={perc} className="h-1" />
                              </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="absolute -right-10 -bottom-10 opacity-[0.05] pointer-events-none text-sky-600 group-hover:scale-110 transition-transform">
                  <Trophy size={200} />
                </div>
              </div>

              {/* Quick Actions */}
              <div className={cn("grid gap-4", globalState.enableSpacedRepetition ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-5" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4")}>
                {globalState.enableSpacedRepetition && (
                  <button 
                    onClick={() => {
                      if (dueQuestions.length > 0) {
                        setSessionAnswers(prev => {
                          const next = { ...prev };
                          dueQuestions.forEach(q => delete next[q.id]);
                          return next;
                        });
                        setReviewSessionQuestions(dueQuestions);
                        setIsReviewMode(true);
                        setSelectedAssignmentId(null);
                        setCurrentQuestionIndex(0);
                        setView('quiz');
                      }
                    }}
                    className={cn(
                      "bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 rounded-2xl border border-white/50 dark:border-slate-800/50 flex items-center gap-4 transition-all group shadow-lg shadow-sky-100/20 dark:shadow-slate-950",
                      dueQuestions.length > 0 ? "hover:border-emerald-200 dark:hover:border-emerald-800 hover:bg-white/80 dark:hover:bg-slate-900/80 cursor-pointer" : "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center text-emerald-500 dark:text-emerald-400 group-hover:scale-110 transition-transform shadow-inner">
                      <BrainCircuit size={24} />
                    </div>
                    <div className="text-left">
                      <h3 className="font-bold text-slate-800 dark:text-slate-200">Spaced Repetition</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400">{dueQuestions.length} questions due</p>
                    </div>
                  </button>
                )}
                <button 
                  onClick={() => setView('review')}
                  className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 rounded-2xl border border-white/50 dark:border-slate-800/50 flex items-center gap-4 transition-all group shadow-lg shadow-sky-100/20 dark:shadow-slate-950 hover:border-sky-200 dark:hover:border-sky-800 hover:bg-white/80 dark:hover:bg-slate-900/80 cursor-pointer"
                >
                  <div className="w-12 h-12 bg-sky-50 dark:bg-sky-900/30 rounded-xl flex items-center justify-center text-sky-500 dark:text-sky-400 group-hover:scale-110 transition-transform shadow-inner">
                    <AlertCircle size={24} />
                  </div>
                  <div className="text-left">
                    <h3 className="font-bold text-slate-800 dark:text-slate-200">Review Mistakes</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{wrongQuestions.length} questions to revisit</p>
                  </div>
                </button>
                <button 
                  onClick={handleAIQBankClick}
                  disabled={isGeneratingAIQuestions}
                  className={cn(
                    "bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 rounded-2xl border border-white/50 dark:border-slate-800/50 flex items-center gap-4 hover:border-indigo-200 dark:hover:border-indigo-800 hover:bg-white/80 dark:hover:bg-slate-900/80 transition-all group shadow-lg shadow-sky-100/20 dark:shadow-slate-950",
                    isGeneratingAIQuestions && "opacity-50 cursor-wait"
                  )}
                >
                  <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center text-indigo-500 dark:text-indigo-400 group-hover:scale-110 transition-transform shadow-inner">
                    {isGeneratingAIQuestions ? <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500" /> : <Sparkles size={24} />}
                  </div>
                  <div className="text-left">
                    <h3 className="font-bold text-slate-800 dark:text-slate-200">AI QBank</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Generate new questions</p>
                  </div>
                </button>
                <button 
                  onClick={() => openFlashcards(null)}
                  className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 rounded-2xl border border-white/50 dark:border-slate-800/50 flex items-center gap-4 hover:border-violet-200 dark:hover:border-violet-800 hover:bg-white/80 dark:hover:bg-slate-900/80 transition-all group shadow-lg shadow-sky-100/20 dark:shadow-slate-950"
                >
                  <div className="w-12 h-12 bg-violet-50 dark:bg-violet-900/30 rounded-xl flex items-center justify-center text-violet-500 dark:text-violet-400 group-hover:scale-110 transition-transform shadow-inner">
                    <Layers size={24} />
                  </div>
                  <div className="text-left">
                    <h3 className="font-bold text-slate-800 dark:text-slate-200">Flashcards</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {totalKnownCards} {totalKnownCards === 1 ? 'card' : 'cards'} marked known
                    </p>
                  </div>
                </button>
                <button 
                  onClick={confirmResetProgress}
                  className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 rounded-2xl border border-white/50 dark:border-slate-800/50 flex items-center gap-4 hover:border-red-200 dark:hover:border-red-800 hover:bg-white/80 dark:hover:bg-slate-900/80 transition-all group shadow-lg shadow-sky-100/20 dark:shadow-slate-950"
                >
                  <div className="w-12 h-12 bg-red-50 dark:bg-red-900/30 rounded-xl flex items-center justify-center text-red-500 dark:text-red-400 group-hover:scale-110 transition-transform shadow-inner">
                    <RotateCcw size={24} />
                  </div>
                  <div className="text-left">
                    <h3 className="font-bold text-slate-800 dark:text-slate-200">Reset Progress</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Clear all saved data</p>
                  </div>
                </button>
              </div>

              {/* Support Developer Banner */}
              <div 
                onClick={() => setShowSupportModal(true)}
                className="bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-indigo-500/10 dark:from-amber-950/20 dark:via-orange-950/20 dark:to-indigo-950/20 border border-amber-200/50 dark:border-amber-900/30 rounded-3xl p-5 sm:p-6 shadow-md cursor-pointer hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-800 transition-all flex flex-col sm:flex-row items-center justify-between gap-4 relative overflow-hidden group"
              >
                <div className="flex items-center gap-4 relative z-10">
                  <div className="w-12 h-12 bg-amber-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-amber-200 dark:shadow-none group-hover:scale-110 transition-transform">
                    <Coffee size={24} />
                  </div>
                  <div className="text-left">
                    <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      ☕ Support the Creator
                      <span className="text-[9px] uppercase tracking-widest font-black bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full">Keep Alive</span>
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      Created by a doctor, for doctors. Help cover hosting fees and support ongoing development to keep this QBank free!
                    </p>
                  </div>
                </div>
                <button className="whitespace-nowrap px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:opacity-95 transition-opacity shadow-md shadow-amber-200 dark:shadow-none">
                  Donate / Buy Me a Coffee
                </button>
              </div>

              {/* Assignment Selection Cards */}
              <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 sm:p-8 rounded-3xl border border-white/50 dark:border-slate-800/50 shadow-xl shadow-sky-100/50 dark:shadow-slate-950">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">Select Assignment</h3>
                  <div className="flex items-center gap-2 text-xs font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/30 px-3 py-1 rounded-full">
                    <BookOpen size={14} />
                    <span>{ASSIGNMENTS.length} Available</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                  {ASSIGNMENTS.map(a => {
                    const prog = globalState.progress[a.id];
                    const comp = Object.keys(prog?.selectedAnswers || {}).length;
                    const tot = a.questions.length;
                    const perc = Math.round((comp / tot) * 100);
                    const isCompleted = comp === tot && tot > 0;
                    const isStarted = comp > 0;

                    return (
                      <motion.div
                        key={a.id}
                        whileHover={{ y: -4 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleStartAssignment(a.id)}
                        className={cn(
                          "relative p-5 rounded-2xl border cursor-pointer transition-all flex flex-col h-full",
                          isCompleted 
                            ? "bg-emerald-50/50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 hover:border-emerald-300 dark:hover:border-emerald-700 hover:shadow-lg hover:shadow-emerald-100/50 dark:hover:shadow-emerald-900/20" 
                            : isStarted
                              ? "bg-sky-50/50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800/50 hover:border-sky-300 dark:hover:border-sky-700 hover:shadow-lg hover:shadow-sky-100/50 dark:hover:shadow-sky-900/20"
                              : "bg-white/80 dark:bg-slate-900/80 border-slate-200 dark:border-slate-800 hover:border-sky-300 dark:hover:border-sky-700 hover:shadow-lg hover:shadow-sky-100/50 dark:hover:shadow-sky-900/20"
                        )}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <div className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                            Assignment {a.id.toString().padStart(2, '0')}
                          </div>
                          <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReportData({ assignmentId: a.id });
                                  setShowReportModal(true);
                                }}
                                className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                title="Report an error in this assignment"
                              >
                                <Flag size={14} />
                              </button>
                             <button
                               onClick={(e) => {
                                 e.stopPropagation();
                                 openFlashcards(moduleDeckId(a.id));
                               }}
                               className="p-1 px-2 text-[10px] font-bold rounded-md transition-colors border text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800 hover:bg-violet-100 dark:hover:bg-violet-900/30"
                               title="Study this module's facts as flashcards"
                             >
                               Cards
                             </button>
                             <button
                               onClick={(e) => {
                                 e.stopPropagation();
                                 handleResetAssignment(a.id);
                               }}
                               className={cn(
                                 "p-1 px-2 text-[10px] font-bold rounded-md transition-colors border",
                                 isCompleted 
                                   ? "text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/30" 
                                   : isStarted
                                     ? "text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800 hover:bg-sky-100 dark:hover:bg-sky-900/30"
                                     : "text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300"
                               )}
                             >
                               RESET
                             </button>
                             {isCompleted && (
                               <div className="text-emerald-500">
                                 <CheckCircle2 size={18} />
                               </div>
                             )}
                          </div>
                        </div>
                        
                        <h4 className="font-bold text-slate-800 dark:text-slate-100 mb-4 flex-1 line-clamp-2">{a.title}</h4>
                        
                        <div className="mt-auto">
                          <div className="flex justify-between items-end mb-2">
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">Progress</p>
                            <p className={cn(
                              "text-xs font-black",
                              isCompleted ? "text-emerald-600 dark:text-emerald-400" : isStarted ? "text-sky-600 dark:text-sky-400" : "text-slate-400 dark:text-slate-500"
                            )}>
                              {perc}% ({comp}/{tot})
                            </p>
                          </div>
                          <ProgressBar 
                            value={perc} 
                            className={cn(
                              "h-1.5",
                              isCompleted ? "bg-emerald-100 dark:bg-emerald-900/30" : isStarted ? "bg-sky-100 dark:bg-sky-900/30" : "bg-slate-100 dark:bg-slate-800"
                            )} 
                            color={isCompleted ? "bg-emerald-500" : isStarted ? "bg-sky-500" : "bg-slate-300 dark:bg-slate-600"}
                          />
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}

          {/* AI QBank Modal */}
          <AnimatePresence>
            {showAIModal && (
              <Modal key="ai-modal-overlay" ariaLabel="AI QBank" onClose={() => setShowAIModal(false)} overlayClassName="flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                <motion.div 
                  key="ai-modal-content"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-white/50 dark:border-slate-800 relative"
                >
                  <button 
                    onClick={() => setShowAIModal(false)}
                    className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  >
                    <X size={24} />
                  </button>
                  
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl flex items-center justify-center text-indigo-500 dark:text-indigo-400 shadow-inner">
                      <Sparkles size={24} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">AI QBank</h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Generate custom questions</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">Assignment Number</label>
                      <input 
                        type="number"
                        placeholder="e.g., 10"
                        aria-label="Assignment Number"
                        value={aiAssignmentInput}
                        onChange={(e) => setAiAssignmentInput(e.target.value)}
                        className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleGenerateAIQuestions();
                          }
                        }}
                      />
                    </div>

                    {aiModalError && (
                      <div className="p-3 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100 flex items-start gap-2">
                        <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                        <p>{aiModalError}</p>
                      </div>
                    )}

                    <button 
                      onClick={handleGenerateAIQuestions}
                      disabled={isGeneratingAIQuestions || !aiAssignmentInput.trim()}
                      className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isGeneratingAIQuestions ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                          Generating...
                        </>
                      ) : (
                        <>
                          Generate Questions
                          <ChevronRight size={18} />
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              </Modal>
            )}
          </AnimatePresence>

          {/* Continue / Restart Modal */}
          <AnimatePresence>
            {pendingAssignmentId !== null && (
              <Modal key="continue-modal-overlay" ariaLabel="Resume Assignment" onClose={() => setPendingAssignmentId(null)} overlayClassName="flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                <motion.div 
                  key="continue-modal-content"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-white/50 dark:border-slate-800 relative"
                >
                  <button 
                    onClick={() => setPendingAssignmentId(null)}
                    className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  >
                    <X size={24} />
                  </button>
                  
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-sky-50 dark:bg-sky-900/30 rounded-xl flex items-center justify-center text-sky-500 dark:text-sky-400 shadow-inner">
                      <History size={24} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Resume Assignment</h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">You have saved progress</p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
                      You started this assignment previously. Would you like to continue from where you left off, or start completely fresh?
                    </p>

                    <div className="flex flex-col gap-3">
                      <button 
                        onClick={executeContinueAssignment}
                        className="w-full py-4 bg-gradient-to-r from-sky-500 to-indigo-600 text-white rounded-2xl font-bold hover:opacity-90 transition-all shadow-lg shadow-sky-200 dark:shadow-sky-900/50 flex items-center justify-center gap-2"
                      >
                        Continue from where I left off
                        <ChevronRight size={18} />
                      </button>
                      <button 
                        onClick={executeRestartAssignmentFromPending}
                        className="w-full py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex items-center justify-center gap-2"
                      >
                        <RotateCcw size={18} />
                        Start Again (Fresh)
                      </button>
                    </div>
                  </div>
                </motion.div>
              </Modal>
            )}
          </AnimatePresence>

          {/* Reset Progress Modal */}
          <AnimatePresence>
            {showResetModal && (
              <Modal key="reset-modal-overlay" ariaLabel="Reset Progress" onClose={() => setShowResetModal(false)} overlayClassName="flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                <motion.div 
                  key="reset-modal-content"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-white/50 relative"
                >
                  <button 
                    onClick={() => setShowResetModal(false)}
                    className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X size={24} />
                  </button>
                  
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-red-500 shadow-inner">
                      <RotateCcw size={24} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">Reset Progress</h2>
                      <p className="text-sm text-slate-500">Clear all saved data</p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
                      Are you sure you want to reset all your progress? This will clear all completed assignments, wrong questions, and spaced repetition data. <strong>This action cannot be undone.</strong>
                    </p>

                    <div className="flex gap-3">
                      <button 
                        onClick={() => setShowResetModal(false)}
                        className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={executeResetProgress}
                        className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-bold hover:bg-red-600 transition-colors shadow-lg shadow-red-200"
                      >
                        Yes, Reset
                      </button>
                    </div>
                  </div>
                </motion.div>
              </Modal>
            )}
            
            {/* Individual Assignment Reset Modal */}
            {assignmentToReset !== null && (
              <Modal key="individual-reset-modal-overlay" ariaLabel="Reset Assignment" onClose={() => setAssignmentToReset(null)} overlayClassName="flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                <motion.div 
                  key="individual-reset-modal-content"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-white/50 relative"
                >
                  <button 
                    onClick={() => setAssignmentToReset(null)}
                    className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X size={24} />
                  </button>
                  
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-red-500 shadow-inner">
                      <RotateCcw size={24} />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">Reset Assignment</h2>
                      <p className="text-sm text-slate-500">Clear specific progress</p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
                      Are you sure you want to reset your progress for <strong>Assignment {assignmentToReset}</strong>? This will clear all completed questions and mistakes for this assignment.
                    </p>

                    <div className="flex gap-3">
                      <button 
                        onClick={() => setAssignmentToReset(null)}
                        className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={executeResetAssignment}
                        className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-bold hover:bg-red-600 transition-colors shadow-lg shadow-red-200"
                      >
                        Confirm Reset
                      </button>
                    </div>
                  </div>
                </motion.div>
              </Modal>
            )}
          </AnimatePresence>

          {view === 'quiz' && selectedAssignment && (
            <motion.div 
              key="quiz"
              ref={quizTopRef}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {/* Quiz Header */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-4 sm:flex-nowrap sm:justify-between">
                <button 
                  onClick={() => globalState.username ? setView('dashboard') : setView('login')}
                  className="order-1 shrink-0 whitespace-nowrap flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-bold text-slate-400 dark:text-slate-500 hover:text-sky-600 dark:hover:text-sky-400 transition-colors"
                >
                  <ChevronLeft size={18} />
                  Back to Dashboard
                </button>
                <div className="order-3 basis-full min-w-0 sm:order-2 sm:basis-auto sm:text-right">
                  <p className="text-xs uppercase tracking-widest font-bold text-slate-300 dark:text-slate-600">{isReviewMode ? "Special Mode" : `Assignment ${selectedAssignment.id}`}</p>
                  <h2 className="font-bold text-sky-600 dark:text-sky-400 text-base sm:text-lg leading-snug break-words">{selectedAssignment.title}</h2>
                  {streak > 1 && (
                    <motion.div 
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="text-[10px] font-black text-orange-500 uppercase tracking-widest mt-1 flex items-center justify-start sm:justify-end gap-1"
                    >
                      <Sparkles size={10} />
                      {streak} Answer Streak
                    </motion.div>
                  )}
                </div>
                <button 
                  onClick={() => {
                    setReportData({ questionId: selectedAssignment.questions[currentQuestionIndex].id, assignmentId: selectedAssignment.id });
                    setShowReportModal(true);
                  }}
                  className="order-2 ml-auto sm:order-3 sm:ml-0 shrink-0 p-2 text-slate-400 hover:text-red-500 transition-colors"
                  title="Report an error in this question"
                >
                  <Flag size={20} />
                </button>
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">
                  <span>Question {currentQuestionIndex + 1} of {selectedAssignment.questions.length}</span>
                  <span>{Object.keys(sessionAnswers).length} of {selectedAssignment.questions.length} Answered</span>
                </div>
                <ProgressBar value={(Object.keys(sessionAnswers).length / selectedAssignment.questions.length) * 100} color="bg-gradient-to-r from-sky-400 to-indigo-500" />
                
                {/* Progress Bubbles */}
                <div className="flex flex-wrap lg:flex-nowrap gap-1 mt-4 p-1 lg:justify-between">
                  {selectedAssignment.questions.map((q, idx) => {
                    const ans = sessionAnswers[q.id];
                    const isCurrent = idx === currentQuestionIndex;
                    const isCorrect = ans !== undefined && ans === q.correctAnswer;
                    const isWrong = ans !== undefined && ans !== q.correctAnswer;
                    
                    return (
                      <motion.div
                        key={`bubble-${q.id}`}
                        initial={false}
                        animate={{ 
                          scale: isCurrent ? 1.3 : 1,
                          opacity: 1 
                        }}
                        className={cn(
                          "w-2 h-2 lg:w-1.5 lg:h-1.5 rounded-full border transition-all duration-300 flex-shrink-0 cursor-pointer",
                          isCurrent ? "border-sky-500 ring-2 ring-sky-200 dark:ring-sky-900 ring-offset-1 dark:ring-offset-slate-950" : "border-transparent",
                          isCorrect ? "bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" : 
                          isWrong ? "bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.5)]" : 
                          "bg-slate-200 dark:bg-slate-800"
                        )}
                        onClick={() => setCurrentQuestionIndex(idx)}
                        role="button"
                        tabIndex={0}
                        aria-label={`Go to question ${idx + 1}`}
                        aria-current={isCurrent ? "true" : undefined}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setCurrentQuestionIndex(idx);
                          }
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              
              {/* Motivation Message Toast */}
              <AnimatePresence>
                {motivationMsg && (
                  <motion.div
                    key={motivationMsg.id}
                    initial={{ opacity: 0, y: 50, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-6 py-3 bg-white dark:bg-slate-900 rounded-full shadow-2xl border border-sky-100 dark:border-slate-800 flex items-center gap-2 pointer-events-none"
                  >
                    <Sparkles className="text-yellow-500" size={20} />
                    <span className="font-bold text-sky-600 dark:text-sky-400 whitespace-nowrap">{motivationMsg.text}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Question Card */}
              <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-2xl sm:rounded-3xl p-4 sm:p-8 shadow-2xl shadow-sky-100/50 dark:shadow-slate-950 border border-white dark:border-slate-800 min-h-[280px] sm:min-h-[400px] flex flex-col">
                <div className="flex-1">
                  <h3 className="text-base sm:text-xl font-medium leading-relaxed mb-4 sm:mb-8 text-slate-800 dark:text-slate-100">
                    {selectedAssignment.questions[currentQuestionIndex].text}
                  </h3>

                  <div className="space-y-2.5 sm:space-y-3">
                    {selectedAssignment.questions[currentQuestionIndex].options.map((option, idx) => {
                      const currentQuestion = selectedAssignment.questions[currentQuestionIndex];
                      const answeredOption = sessionAnswers[currentQuestion.id];
                      const isAnswered = answeredOption !== undefined;
                      const isSelected = answeredOption === idx;
                      const isCorrect = idx === currentQuestion.correctAnswer;
                      
                      let variantClass = "border-sky-100/50 dark:border-slate-800 hover:border-sky-300 dark:hover:border-sky-700 hover:bg-sky-50/50 dark:hover:bg-sky-900/10 text-slate-700 dark:text-slate-300";
                      if (isAnswered) {
                        if (isCorrect) variantClass = "border-emerald-500 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500 shadow-lg shadow-emerald-100 dark:shadow-emerald-900/20";
                        else if (isSelected) variantClass = "border-red-500 dark:border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 ring-1 ring-red-500 shadow-lg shadow-red-100 dark:shadow-red-900/20";
                        else variantClass = "opacity-40 border-sky-100/50 dark:border-slate-800";
                      }

                      return (
                        <button
                          key={`option-${currentQuestion.id}-${idx}`}
                          disabled={isAnswered}
                          onClick={() => handleOptionSelect(idx)}
                          className={cn(
                            "w-full p-3.5 sm:p-5 rounded-xl sm:rounded-2xl border text-left text-xs sm:text-base transition-all flex items-center justify-between group",
                            variantClass
                          )}
                        >
                          <span className="flex-1 pr-3 sm:pr-4">{option}</span>
                          {isAnswered && isCorrect && <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />}
                          {isAnswered && isSelected && !isCorrect && <X size={18} className="text-red-500 flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Explanation Area */}
                <AnimatePresence>
                  {sessionAnswers[selectedAssignment.questions[currentQuestionIndex].id] !== undefined && (
                    <motion.div 
                      key={`explanation-${selectedAssignment.questions[currentQuestionIndex].id}`}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-8 pt-8 border-t border-sky-100/50 dark:border-slate-800 space-y-6"
                    >
                      <div className="bg-sky-50/50 dark:bg-sky-900/10 p-6 rounded-2xl border border-sky-100/50 dark:border-sky-900/30">
                        <h4 className="text-xs uppercase tracking-widest font-bold text-sky-700 dark:text-sky-400 mb-2 flex items-center gap-2">
                          <Info size={14} />
                          Explanation
                        </h4>
                        <p className="text-sm leading-relaxed text-sky-900/80 dark:text-sky-200/80">
                          {selectedAssignment.questions[currentQuestionIndex].explanation}
                        </p>
                      </div>

                      {/* AI Section */}
                      <div className="pt-2">
                        {(() => {
                          const currentQuestion = selectedAssignment?.questions[currentQuestionIndex];
                          if (!currentQuestion) return null;
                          const currentAi = aiCache[currentQuestion.id] || { text: null, loading: false, detailed: false };
                          
                          if (currentAi.text) {
                            return (
                              <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl border border-sky-100 dark:border-slate-700 rounded-3xl p-5 sm:p-6 shadow-xl shadow-sky-100/50 dark:shadow-slate-950">
                                <div className="flex items-center justify-between mb-4">
                                  <h4 className="text-xs uppercase tracking-widest font-bold text-sky-600 dark:text-sky-400 flex items-center gap-2">
                                    <BrainCircuit size={16} />
                                    AI Insights
                                  </h4>
                                  {!currentAi.detailed && (
                                    <button 
                                      onClick={() => handleAiExplain(true)}
                                      disabled={currentAi.loading}
                                      className="text-[10px] font-bold bg-sky-600 text-white px-3 py-1 rounded-full hover:bg-sky-700 transition-colors shadow-md shadow-sky-200 disabled:opacity-50 flex items-center gap-2"
                                    >
                                      {currentAi.loading && <div className="w-2 h-2 lg:w-1.5 lg:h-1.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
                                      EXPLAIN MORE
                                    </button>
                                  )}
                                </div>
                                <div className="prose prose-sm prose-sky dark:prose-invert max-w-none prose-headings:text-sky-800 dark:prose-headings:text-sky-300 prose-strong:text-sky-700 dark:prose-strong:text-sky-400 prose-a:text-sky-600 dark:prose-a:text-sky-400 prose-code:text-indigo-600 dark:prose-code:text-indigo-400 prose-code:bg-indigo-50 dark:prose-code:bg-indigo-900/30 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-slate-800 dark:prose-pre:bg-slate-950 prose-pre:text-slate-50 prose-li:marker:text-sky-400 dark:prose-li:marker:text-sky-500 prose-img:rounded-xl">
                                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeSanitize, rehypeKatex]}>{currentAi.text || ""}</ReactMarkdown>
                                  {currentAi.loading && currentAi.detailed && (
                                    <div className="mt-6 space-y-3 animate-pulse">
                                      <div className="h-3 bg-sky-100 dark:bg-sky-900/20 rounded w-full"></div>
                                      <div className="h-3 bg-sky-100 dark:bg-sky-900/20 rounded w-5/6"></div>
                                      <div className="h-3 bg-sky-100 dark:bg-sky-900/20 rounded w-4/6"></div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          }

                          if (currentAi.loading && !currentAi.text) {
                            return (
                              <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl border border-sky-100 dark:border-slate-700 rounded-3xl p-5 sm:p-6 shadow-xl shadow-sky-100/50 dark:shadow-slate-950 animate-pulse">
                                <div className="flex items-center gap-2 mb-4">
                                  <BrainCircuit size={16} className="text-sky-400" />
                                  <div className="h-4 bg-sky-200/50 dark:bg-sky-900/30 rounded w-24"></div>
                                </div>
                                <div className="space-y-3">
                                  <div className="h-3 bg-sky-100 dark:bg-sky-900/20 rounded w-3/4"></div>
                                  <div className="h-3 bg-sky-100 dark:bg-sky-900/20 rounded w-full"></div>
                                  <div className="h-3 bg-sky-100 dark:bg-sky-900/20 rounded w-5/6"></div>
                                </div>
                              </div>
                            );
                          }

                          if (askedForKeyForQId === currentQuestion.id && !globalState.apiKey) {
                            return (
                              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl p-4 border border-amber-100 dark:border-amber-800/50 flex flex-col sm:flex-row items-center gap-4">
                                <div className="w-10 h-10 bg-amber-100 dark:bg-amber-800/50 text-amber-600 dark:text-amber-400 rounded-xl flex items-center justify-center flex-shrink-0">
                                  <Settings size={20} />
                                </div>
                                <div className="flex-1 text-center sm:text-left">
                                  <h4 className="text-xs font-bold text-amber-800 dark:text-amber-200 uppercase tracking-wider">AI Key Required</h4>
                                  <p className="text-[10px] text-amber-700/70 dark:text-amber-400/70 leading-relaxed">Detailed AI insights require a free Gemini API key. Add yours in settings to unlock this for all questions.</p>
                                </div>
                                <button 
                                  onClick={() => {
                                    setPreviousView(view);
                                    setView('settings');
                                  }}
                                  className="whitespace-nowrap px-4 py-2 bg-amber-600 text-white rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-amber-700 transition-colors shadow-sm"
                                >
                                  Open Settings
                                </button>
                              </div>
                            );
                          }

                          return (
                            <button
                              onClick={() => {
                                if (!globalState.apiKey) {
                                  setAskedForKeyForQId(currentQuestion.id);
                                } else {
                                  handleAiExplain();
                                }
                              }}
                              className="py-2.5 px-5 bg-gradient-to-r from-sky-500 to-indigo-600 text-white rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-md shadow-sky-200 w-fit"
                            >
                              <BrainCircuit size={16} />
                              <span className="font-bold uppercase tracking-wider text-xs">
                                AI Explain
                              </span>
                            </button>
                          );
                        })()}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Navigation Bar */}
              <div className="flex items-center gap-3 sm:gap-4">
                <button
                  onClick={handlePrev}
                  disabled={currentQuestionIndex === 0}
                  className="flex-1 py-3.5 sm:py-4 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-white/50 dark:border-slate-800/50 rounded-xl sm:rounded-2xl font-bold text-xs sm:text-base text-slate-600 dark:text-slate-300 flex items-center justify-center gap-1.5 sm:gap-2 hover:bg-white/80 dark:hover:bg-slate-900/80 transition-all disabled:opacity-20 shadow-lg shadow-sky-100/20 dark:shadow-slate-950"
                >
                  <ChevronLeft size={18} className="sm:hidden" />
                  <ChevronLeft size={20} className="hidden sm:block" />
                  Previous
                </button>
                  <button
                    onClick={() => {
                      if (sessionAnswers[selectedAssignment.questions[currentQuestionIndex].id] === undefined) {
                        handleSkip();
                      } else {
                        handleNext();
                      }
                    }}
                    className="flex-1 py-3.5 sm:py-4 bg-sky-600 text-white rounded-xl sm:rounded-2xl font-bold text-xs sm:text-base flex items-center justify-center gap-1.5 sm:gap-2 hover:bg-sky-700 transition-all shadow-lg shadow-sky-200 dark:shadow-sky-900/50"
                  >
                    {sessionAnswers[selectedAssignment.questions[currentQuestionIndex].id] === undefined ? (
                      <>
                        Skip & View Answer
                        <ChevronRight size={18} className="sm:hidden" />
                        <ChevronRight size={20} className="hidden sm:block" />
                      </>
                    ) : currentQuestionIndex === selectedAssignment.questions.length - 1 ? (
                      "Finish & View Results"
                    ) : (
                      <>
                        Next
                        <ChevronRight size={18} className="sm:hidden" />
                        <ChevronRight size={20} className="hidden sm:block" />
                      </>
                    )}
                  </button>
              </div>
            </motion.div>
          )}

          {view === 'review' && globalState.username && (
            <motion.div 
              key="review"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <button 
                  onClick={() => setView('dashboard')}
                  className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-sky-600 transition-colors"
                >
                  <ChevronLeft size={18} />
                  Back
                </button>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Mistake QBank</h2>
              </div>

              {wrongQuestions.length === 0 ? (
                <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-3xl p-12 text-center border border-white/50 dark:border-slate-800/50 shadow-xl shadow-sky-100/50 dark:shadow-slate-950">
                  <div className="w-20 h-20 bg-sky-50 dark:bg-sky-900/30 text-sky-500 dark:text-sky-400 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
                    <CheckCircle2 size={40} />
                  </div>
                  <h3 className="text-xl font-bold mb-2 text-slate-800 dark:text-slate-100">Clean Slate!</h3>
                  <p className="text-slate-500 dark:text-slate-400">You haven't made any mistakes yet. Keep it up!</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Start Quiz Button */}
                  <button 
                    onClick={() => handleStartReviewQuiz(0)}
                    className="w-full py-5 sm:py-6 bg-gradient-to-r from-sky-500 to-indigo-600 text-white rounded-3xl font-black text-base sm:text-lg uppercase tracking-widest shadow-xl shadow-sky-200 hover:opacity-90 transition-all flex items-center justify-center gap-3 sm:gap-4"
                  >
                    <BrainCircuit size={24} className="sm:w-7 sm:h-7" />
                    Start Review Quiz
                  </button>

                  <div className="space-y-4">
                    <h3 className="text-xs uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">List of Mistakes ({wrongQuestions.length})</h3>
                    <div className="grid grid-cols-1 gap-3">
                      {wrongQuestions.map((q, i) => (
                        <div 
                          key={`mistake-${q.id}-${i}`} 
                          onClick={() => handleStartReviewQuiz(i)}
                          className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-5 rounded-2xl border border-white/50 dark:border-slate-800/50 space-y-2 shadow-sm hover:shadow-md hover:border-sky-200 dark:hover:border-sky-800 hover:bg-white/90 dark:hover:bg-slate-900/90 transition-all cursor-pointer group"
                        >
                          <div className="flex justify-between items-start">
                            <span className="text-[10px] font-black bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400 px-2 py-1 rounded uppercase tracking-wider">Mistake #{i+1}</span>
                            <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 group-hover:text-sky-500 dark:group-hover:text-sky-400 transition-colors" />
                          </div>
                          <p className="font-medium text-sm text-slate-700 dark:text-slate-300 line-clamp-2">{q.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {view === 'flashcards' && globalState.username && (() => {
            if (flashcardDeckId !== null && flashcardDeckId >= 2000) {
              const lecture = flashcardDeckId - 2000;
              const curatedDeck = CURATED_FLASHCARDS[lecture];
              if (curatedDeck) {
                return (
                  <motion.div
                    key={`flashcards-${flashcardDeckId}`}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                  >
                    <Flashcards
                      key={flashcardDeckId}
                      deckTitle={`Module ${lecture} — Sourced notes`}
                      cards={curatedDeck.map(c => ({ id: c.id, front: c.front, back: c.back, tag: `Module ${lecture}`, note: c.note ?? (c.flag === 'CHECK' ? `⚠️ CHECK: ${c.check_reason ?? ''}` : undefined) }))}
                      backLabel="Key facts"
                      frontLabel="Recall"
                      knownCardIds={globalState.progress[curatedDeckId(lecture)]?.knownCardIds || []}
                      onToggleKnown={(qid, known) => handleToggleKnownCard(curatedDeckId(lecture), qid, known)}
                      srs={globalState.progress[curatedDeckId(lecture)]?.cardSrs || {}}
                      onGradeCard={(cardId, grade) => handleGradeCard(curatedDeckId(lecture), cardId, grade)}
                      onExit={() => setView('dashboard')}
                    />
                  </motion.div>
                );
              }
            }
            if (flashcardDeckId !== null && flashcardDeckId >= 1000) {
              const lecture = flashcardDeckId - 1000;
              const moduleDeck = MODULE_FLASHCARDS[lecture];
              if (moduleDeck) {
                return (
                  <motion.div
                    key={`flashcards-${flashcardDeckId}`}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                  >
                    <Flashcards
                      key={flashcardDeckId}
                      deckTitle={`Module ${lecture}: ${ASSIGNMENTS.find(a => a.id === lecture)?.title ?? ''}`}
                      cards={moduleDeck.map(c => ({ id: c.id, front: c.front, back: c.back, tag: `Module ${lecture}` }))}
                      backLabel="Key facts"
                      frontLabel="Recall"
                      knownCardIds={globalState.progress[moduleDeckId(lecture)]?.knownCardIds || []}
                      onToggleKnown={(qid, known) => handleToggleKnownCard(moduleDeckId(lecture), qid, known)}
                      srs={globalState.progress[moduleDeckId(lecture)]?.cardSrs || {}}
                      onGradeCard={(cardId, grade) => handleGradeCard(moduleDeckId(lecture), cardId, grade)}
                      onExit={() => setView('dashboard')}
                    />
                  </motion.div>
                );
              }
            }
            if (flashcardDeckId === REVISION_DECK_ID) {
              return (
                <motion.div
                  key={`flashcards-${REVISION_DECK_ID}`}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                >
                  <Flashcards
                    key={REVISION_DECK_ID}
                    deckTitle={REVISION_DECK_TITLE}
                    cards={REVISION_CARDS.map(c => ({ id: c.id, front: c.front, back: c.back, tag: c.module === 0 ? 'Exam' : `Module ${c.module}` }))}
                    backLabel="Key facts"
                    frontLabel="Recall"
                    knownCardIds={globalState.progress[REVISION_DECK_ID]?.knownCardIds || []}
                    onToggleKnown={(qid, known) => handleToggleKnownCard(REVISION_DECK_ID, qid, known)}
                    srs={globalState.progress[REVISION_DECK_ID]?.cardSrs || {}}
                    onGradeCard={(cardId, grade) => handleGradeCard(REVISION_DECK_ID, cardId, grade)}
                    onExit={() => setView('dashboard')}
                  />
                </motion.div>
              );
            }
            {
              return (
                <motion.div 
                  key="flashcards-picker"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <button 
                      onClick={() => setView('dashboard')}
                      className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-sky-600 transition-colors"
                    >
                      <ChevronLeft size={18} />
                      Back
                    </button>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Flashcards</h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <button
                      key={REVISION_DECK_ID}
                      onClick={() => openFlashcards(REVISION_DECK_ID)}
                      className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-3xl border border-violet-200/70 dark:border-violet-800/60 p-5 flex items-center gap-4 text-left transition-all group hover:border-violet-400 dark:hover:border-violet-600 hover:shadow-lg hover:shadow-violet-100/50 dark:hover:shadow-violet-900/20"
                    >
                      <div className="w-12 h-12 shrink-0 bg-violet-50 dark:bg-violet-900/30 rounded-xl flex items-center justify-center text-violet-500 dark:text-violet-400 group-hover:scale-110 transition-transform shadow-inner">
                        <Layers size={24} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-slate-800 dark:text-slate-200 line-clamp-2 flex items-center gap-2 flex-wrap">
                          Last-Minute Revision
                          <span className="text-[10px] uppercase tracking-widest font-bold bg-violet-100/70 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full">
                            New
                          </span>
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          {REVISION_CARDS.length} cards · all 23 modules · {countKnownInIds(globalState.progress[REVISION_DECK_ID]?.knownCardIds || [], REVISION_CARDS.map(c => c.id))} known · {countDueCards(REVISION_DECK_ID, REVISION_CARDS.map(c => c.id))} due
                        </p>
                      </div>
                    </button>
                    {(() => {
                      const curatedModuleIds = Object.keys(CURATED_FLASHCARDS).map(Number).sort((a, b) => a - b);
                      if (curatedModuleIds.length === 0) return null;
                      return (
                        <>
                          <div className="col-span-full text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500 pt-2">
                            Sourced notes — curated from NPTEL &amp; ICMR
                          </div>
                          {curatedModuleIds.map(id => {
                            const curatedCards = CURATED_FLASHCARDS[id];
                            const title = ASSIGNMENTS.find(a => a.id === id)?.title ?? CURATED_MODULE_TITLES[id] ?? `Module ${id}`;
                            return (
                              <button
                                key={`curated-${id}`}
                                onClick={() => openFlashcards(curatedDeckId(id))}
                                className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-3xl border border-emerald-200/70 dark:border-emerald-800/60 p-5 flex items-center gap-4 text-left transition-all group hover:border-emerald-400 dark:hover:border-emerald-600 hover:shadow-lg hover:shadow-emerald-100/50 dark:hover:shadow-emerald-900/20"
                              >
                                <div className="w-12 h-12 shrink-0 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center text-emerald-500 dark:text-emerald-400 group-hover:scale-110 transition-transform shadow-inner">
                                  <Layers size={24} />
                                </div>
                                <div className="min-w-0">
                                  <h3 className="font-bold text-slate-800 dark:text-slate-200 line-clamp-2">{`Module ${id}: ${title}`}</h3>
                                  <p className="text-sm text-slate-500 dark:text-slate-400">
                                    {curatedCards.length} cards · {countKnownInIds(globalState.progress[curatedDeckId(id)]?.knownCardIds || [], curatedCards.map(c => c.id))} known · {countDueCards(curatedDeckId(id), curatedCards.map(c => c.id))} due
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </>
                      );
                    })()}
                    <div className="col-span-full text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500 pt-2">
                      Module flashcards — 50 facts per module
                    </div>
                    {ASSIGNMENTS.map(a => {
                      const moduleCards = MODULE_FLASHCARDS[a.id];
                      if (!moduleCards) return null;
                      return (
                        <button
                          key={a.id}
                          onClick={() => openFlashcards(moduleDeckId(a.id))}
                          className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-3xl border border-white dark:border-slate-800 p-5 flex items-center gap-4 text-left transition-all group hover:border-violet-300 dark:hover:border-violet-700 hover:shadow-lg hover:shadow-violet-100/50 dark:hover:shadow-violet-900/20"
                        >
                          <div className="w-12 h-12 shrink-0 bg-violet-50 dark:bg-violet-900/30 rounded-xl flex items-center justify-center text-violet-500 dark:text-violet-400 group-hover:scale-110 transition-transform shadow-inner">
                            <Layers size={24} />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-slate-800 dark:text-slate-200 line-clamp-2">{a.title}</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                              {moduleCards.length} cards · {countKnownInIds(globalState.progress[moduleDeckId(a.id)]?.knownCardIds || [], moduleCards.map(c => c.id))} known · {countDueCards(moduleDeckId(a.id), moduleCards.map(c => c.id))} due
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              );
            }
          })()}

          {view === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-md mx-auto space-y-8"
            >
              <div className="flex items-center gap-4">
                <button onClick={() => {
                    if (previousView && previousView !== 'settings') {
                      setView(previousView);
                      setPreviousView(null);
                    } else {
                      setView(globalState.username ? 'dashboard' : 'login');
                    }
                  }} className="p-2 hover:bg-sky-100/50 dark:hover:bg-slate-800/50 rounded-full text-sky-600 dark:text-sky-400 transition-colors">
                  <ChevronLeft size={24} />
                </button>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">AI Settings</h2>
              </div>

              <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-8 rounded-3xl border border-white/50 dark:border-slate-800/50 shadow-2xl shadow-sky-100/50 dark:shadow-slate-950 space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Gemini API Key</label>
                  <input 
                    type="password"
                    placeholder="Enter your API key..."
                    aria-label="Enter your API key..."
                    value={globalState.apiKey || ''}
                    onChange={(e) => setGlobalState(prev => ({ ...prev, apiKey: e.target.value }))}
                    className="w-full p-4 bg-sky-50/50 dark:bg-slate-800/50 rounded-2xl border border-sky-100/50 dark:border-slate-700 focus:ring-2 focus:ring-sky-500 dark:text-slate-100 transition-all outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Learning Mode</label>
                  <div className="flex items-center justify-between p-4 bg-sky-50/50 dark:bg-slate-800/50 rounded-2xl border border-sky-100/50 dark:border-slate-700">
                    <div>
                      <h4 className="font-bold text-slate-800 dark:text-slate-100">Spaced Repetition</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Use SM-2 algorithm to schedule reviews instead of a simple mistake bank.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={globalState.enableSpacedRepetition || false}
                        onChange={(e) => setGlobalState(prev => ({ ...prev, enableSpacedRepetition: e.target.checked }))}
                      />
                      <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-sky-300 dark:peer-focus:ring-sky-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
                    </label>
                  </div>
                </div>

                <div className="bg-sky-50/50 dark:bg-sky-900/10 p-6 rounded-2xl space-y-4 border border-sky-100/50 dark:border-sky-900/30">
                  <div className="flex items-center gap-2 text-sky-700 dark:text-sky-400">
                    <Info size={18} />
                    <h4 className="font-bold">How to get a key?</h4>
                  </div>
                  <ol className="text-sm text-sky-900/70 dark:text-sky-200/70 space-y-3 list-decimal pl-4">
                    <li>Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" className="underline font-bold">Google AI Studio</a></li>
                    <li>Click on <strong>"Create API key"</strong></li>
                    <li>Copy the key and paste it above</li>
                    <li>This key is stored <strong>locally</strong> on your device</li>
                  </ol>
                </div>

                <button 
                  onClick={() => {
                    if (previousView && previousView !== 'settings') {
                      setView(previousView);
                      setPreviousView(null);
                    } else {
                      setView(globalState.username ? 'dashboard' : 'login');
                    }
                  }}
                  className="w-full py-4 bg-gradient-to-r from-sky-500 to-indigo-600 text-white rounded-2xl font-bold hover:opacity-90 transition-all shadow-lg shadow-sky-200 dark:shadow-sky-900/50"
                >
                  Save & Return
                </button>
              </div>

              {/* About Card */}
              <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-8 rounded-3xl border border-white/50 dark:border-slate-800/50 shadow-2xl space-y-4">
                <div className="flex items-center gap-3 text-sky-600 dark:text-sky-400">
                  <GraduationCap size={24} />
                  <h3 className="text-xl font-bold">About</h3>
                </div>
                <div className="space-y-4">
                  <p className="text-slate-700 dark:text-slate-300 font-medium flex items-center gap-2">
                    Created by 
                    <a 
                      href="https://www.linkedin.com/in/draswanth/" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-bold"
                    >
                      <Linkedin size={16} className="text-[#0A66C2]" /> <span className="text-orange-600 dark:text-orange-500 hover:text-orange-700 hover:underline">(Click to add me on LinkedIn)</span>
                    </a>
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 italic">MD Pharmacology Resident</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">Dedicated to providing high-quality educational resources for BCBR preparation and medical mastery.</p>
                </div>
              </div>

              {/* Support Card in Settings */}
              <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-8 rounded-3xl border border-white/50 dark:border-slate-800/50 shadow-2xl space-y-4">
                <div className="flex items-center gap-3 text-amber-500">
                  <Coffee size={24} />
                  <h3 className="text-xl font-bold">Support the App</h3>
                </div>
                <div className="space-y-4 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  <p>
                    BCBR QBank is built and maintained by <strong>Dr. Aswanth Krishnan</strong>, a busy MD Pharmacology resident, to help fellow doctors for free.
                  </p>
                  <p>
                    If this app has helped you, please consider donating a small amount to cover server hosting and keep the project alive.
                  </p>
                  <button 
                    onClick={() => setShowSupportModal(true)}
                    className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-2xl font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-md shadow-amber-200/50 dark:shadow-none"
                  >
                    <Coffee size={18} />
                    Donate / Buy Me a Coffee
                  </button>
                </div>
              </div>

              {/* Legal Card */}
              <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-8 rounded-3xl border border-white/50 dark:border-slate-800/50 shadow-2xl space-y-4">
                <div className="flex items-center gap-3 text-red-500">
                  <AlertCircle size={24} />
                  <h3 className="text-xl font-bold">Legal Disclaimer</h3>
                </div>
                <div className="space-y-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  <p>• Accuracy of questions and answers is for educational reference only. While we strive for 100% accuracy, errors may exist.</p>
                  <p>• The creator and developers are not liable for any impact on official exam results or professional practice.</p>
                  <p>• Use of copyrighted QBank material is intended under fair use for educational analysis.</p>
                </div>
              </div>

              {/* Contact Us Card */}
              <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-8 rounded-3xl border border-white/50 dark:border-slate-800/50 shadow-2xl space-y-6">
                <div className="flex items-center gap-3 text-indigo-500">
                  <History size={24} />
                  <h3 className="text-xl font-bold">Contact Us</h3>
                </div>
                
                <form onSubmit={handleFeedbackSubmit} className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    {['suggestion', 'review', 'complaint'].map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setFeedbackForm(prev => ({ ...prev, type: t }))}
                        className={cn(
                          "py-2 text-[10px] font-bold uppercase tracking-widest rounded-xl border transition-all",
                          feedbackForm.type === t 
                            ? "bg-indigo-600 text-white border-transparent" 
                            : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-600"
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  
                  <textarea 
                    placeholder="Your message, suggestions, or complaints..."
                    aria-label="Your message, suggestions, or complaints..."
                    value={feedbackForm.message}
                    onChange={(e) => setFeedbackForm(prev => ({ ...prev, message: e.target.value }))}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 transition-all outline-none min-h-[100px] text-sm resize-none"
                  />

                  <input
                    type="text"
                    placeholder="Email or WhatsApp number (required for response)"
                    aria-label="Email or WhatsApp number (required for response)"
                    value={feedbackForm.contact}
                    onChange={(e) => setFeedbackForm(prev => ({ ...prev, contact: e.target.value }))}
                    className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 transition-all outline-none text-sm"
                  />

                  <button 
                    type="submit"
                    disabled={isSubmittingFeedback || !feedbackForm.message.trim() || !feedbackForm.contact.trim()}
                    className={cn(
                      "w-full py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2",
                      feedbackSuccess 
                        ? "bg-emerald-500 text-white" 
                        : "bg-indigo-600 text-white hover:opacity-90"
                    )}
                  >
                    {isSubmittingFeedback ? "Sending..." : feedbackSuccess ? "Message Sent! ✨" : "Send Message"}
                  </button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results View Modal */}
        <AnimatePresence>
          {showResults && (
            <Modal ariaLabel="Assignment Complete!" overlayClassName="flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-white dark:bg-slate-900 rounded-[32px] p-6 sm:p-8 max-w-md w-full shadow-2xl border border-white/50 dark:border-slate-800 relative z-10 overflow-hidden max-h-[90vh] overflow-y-auto custom-scrollbar"
              >
                {/* Glassmorphic Background for Trophy */}
                <div className="absolute top-0 left-0 right-0 h-48 bg-gradient-to-b from-sky-500/10 to-transparent -z-0" />
                
                <div className="relative z-10 text-center">
                  <motion.div
                    initial={{ scale: 0, rotate: -20 }}
                    animate={{ scale: 1.2, rotate: 0 }}
                    transition={{ type: 'spring', damping: 10, delay: 0.2 }}
                    className="w-28 h-28 mx-auto mb-4 flex items-center justify-center bg-gradient-to-br from-yellow-400/20 to-orange-500/20 rounded-full border border-yellow-200/50 dark:border-yellow-900/30 shadow-inner group relative"
                  >
                    <motion.div
                      animate={{ 
                        y: [0, -10, 0],
                      }}
                      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Trophy size={56} className="text-yellow-500 drop-shadow-[0_0_20px_rgba(234,179,8,0.6)]" />
                    </motion.div>
                    
                    {/* Animated Sparkles around trophy */}
                    <motion.div 
                      animate={{ opacity: [0, 1, 0], scale: [0.5, 1, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity, delay: 0 }}
                      className="absolute top-3 right-3 text-yellow-300"
                    >
                      <Sparkles size={16} />
                    </motion.div>
                    <motion.div 
                      animate={{ opacity: [0, 1, 0], scale: [0.5, 1, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity, delay: 1 }}
                      className="absolute bottom-3 left-3 text-orange-300"
                    >
                      <Sparkles size={14} />
                    </motion.div>
                  </motion.div>
                  
                  <h2 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-slate-100 mb-1">Assignment Complete!</h2>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-5">Great job on finishing this session.</p>

                  {/* Marks & Score Summary Card */}
                  {(() => {
                    const totalQ = selectedAssignment?.questions.length || 0;
                    const correctQ = selectedAssignmentId ? (globalState.progress[selectedAssignmentId]?.completedQuestionIds?.length || 0) : 0;
                    const percentage = totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : 0;
                    
                    let gradeColor = "from-emerald-500 to-teal-600";
                    let gradeBadge = "PASSED • EXCELLENT 🎉";
                    if (percentage < 50) {
                      gradeColor = "from-amber-500 to-orange-600";
                      gradeBadge = "NEEDS PRACTICE 💪";
                    } else if (percentage < 80) {
                      gradeColor = "from-sky-500 to-blue-600";
                      gradeBadge = "GOOD JOB 👍";
                    }

                    return (
                      <div className="bg-gradient-to-br from-slate-50 to-sky-50/60 dark:from-slate-800/80 dark:to-slate-800/40 rounded-3xl p-4.5 mb-5 border border-sky-100 dark:border-slate-700 shadow-sm text-center">
                        <span className={`inline-block px-3 py-1 rounded-full text-[10px] font-black tracking-widest text-white bg-gradient-to-r ${gradeColor} mb-2 shadow-sm uppercase`}>
                          {gradeBadge}
                        </span>
                        <div className="flex items-baseline justify-center gap-1.5 my-1">
                          <span className="text-4xl font-black text-slate-800 dark:text-white tracking-tight">
                            {correctQ}
                          </span>
                          <span className="text-lg font-bold text-slate-400 dark:text-slate-500">
                            / {totalQ} Marks
                          </span>
                        </div>
                        <div className="text-xs font-bold text-sky-600 dark:text-sky-400">
                          Score: {percentage}% Accuracy
                        </div>
                      </div>
                    );
                  })()}
                  
                  {/* Cumulative Stats Section */}
                  <div className="grid grid-cols-3 gap-3 mb-5">
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-2xl border border-emerald-100 dark:border-emerald-800/50">
                      <div className="text-xl font-black text-emerald-600 dark:text-emerald-400">
                        {selectedAssignmentId ? (globalState.progress[selectedAssignmentId]?.completedQuestionIds?.length || 0) : 0}
                      </div>
                      <div className="text-[10px] uppercase tracking-widest font-bold text-emerald-600/60 dark:text-emerald-400/60">Correct</div>
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-2xl border border-red-100 dark:border-red-800/50">
                      <div className="text-xl font-black text-red-600 dark:text-red-400">
                        {selectedAssignmentId ? (globalState.progress[selectedAssignmentId]?.wrongQuestionIds?.length || 0) : 0}
                      </div>
                      <div className="text-[10px] uppercase tracking-widest font-bold text-red-600/60 dark:text-red-400/60">Wrong</div>
                    </div>
                    <div className="bg-sky-50 dark:bg-sky-900/20 p-3 rounded-2xl border border-sky-100 dark:border-sky-800/50">
                      <div className="text-xl font-black text-sky-600 dark:text-sky-400">
                        {selectedAssignment?.questions.length || 0}
                      </div>
                      <div className="text-[10px] uppercase tracking-widest font-bold text-sky-600/60 dark:text-sky-400/60">Total</div>
                    </div>
                  </div>

                  {/* Visual Mastery Bar */}
                  <div className="bg-sky-50/60 dark:bg-sky-900/20 rounded-2xl p-4 mb-5 border border-sky-100 dark:border-sky-900/30 text-left">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs uppercase tracking-widest font-black text-sky-700 dark:text-sky-400 flex items-center gap-2">
                        <Trophy size={14} />
                        Assignment Mastery
                      </h4>
                    </div>
                    <ProgressBar 
                      value={selectedAssignment ? ((Object.keys(globalState.progress[selectedAssignment.id]?.selectedAnswers || {}).length) / selectedAssignment.questions.length) * 100 : 0} 
                      color="bg-sky-500"
                    />
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 font-medium">Overall progress across all sessions.</p>
                  </div>

                  {/* Support Developer & Donate Card */}
                  <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 p-4.5 rounded-2xl border border-amber-200/80 dark:border-amber-800/50 mb-6 text-left shadow-sm relative overflow-hidden">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 bg-amber-500 text-white rounded-xl flex items-center justify-center shrink-0 shadow-md">
                        <Coffee size={18} className="animate-pulse" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-bold text-xs sm:text-sm text-slate-800 dark:text-amber-200">
                          Support the Developer to Keep App Running ☕
                        </h4>
                        <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                          If you are enjoying this app, please consider supporting the developer to keep it running free! Even small donations of <strong>₹50 or ₹100</strong> can make a huge difference.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setShowSupportModal(true);
                      }}
                      className="mt-3 w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-md shadow-amber-500/20 transition-all uppercase tracking-wider"
                    >
                      <Coffee size={16} />
                      Donate Now & Buy Me a Coffee
                    </button>
                  </div>

                  <div className="space-y-3">
                    <button 
                      onClick={() => {
                        setShowResults(false);
                        if (selectedAssignmentId) executeRestartAssignmentFromPending(selectedAssignmentId);
                      }}
                      className="w-full py-4 bg-red-500 text-white rounded-2xl font-bold hover:bg-red-600 transition-all shadow-lg shadow-red-200 dark:shadow-red-900/50 flex items-center justify-center gap-2"
                    >
                      Reset & Do Again
                      <RotateCcw size={18} />
                    </button>
                    <button 
                      onClick={() => {
                        setShowResults(false);
                        handleStartReviewQuiz(0);
                      }}
                      className="w-full py-4 bg-sky-600 text-white rounded-2xl font-bold hover:bg-sky-700 transition-all shadow-lg shadow-sky-200 dark:shadow-sky-900/50 flex items-center justify-center gap-2"
                    >
                      Review Mistakes
                      <ChevronRight size={18} />
                    </button>
                    <button 
                      onClick={() => {
                        setShowResults(false);
                        setCurrentQuestionIndex(0);
                      }}
                      className="w-full py-4 bg-indigo-500 text-white rounded-2xl font-bold hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-200 dark:shadow-indigo-900/50 flex items-center justify-center gap-2"
                    >
                      View Attempt History
                      <History size={18} />
                    </button>
                    <button 
                      onClick={handleReturnToDashboard}
                      className="w-full py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex items-center justify-center gap-2"
                    >
                      Return to Dashboard
                    </button>
                  </div>
                </div>
              </motion.div>
            </Modal>
          )}
        </AnimatePresence>

        {/* Report Error Modal */}
        <AnimatePresence>
          {showReportModal && (
            <Modal ariaLabel="Report Error" onClose={() => setShowReportModal(false)} overlayClassName="z-[60] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
                onClick={() => setShowReportModal(false)}
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-white/50 dark:border-slate-800 relative"
              >
                <button 
                  onClick={() => setShowReportModal(false)}
                  className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                >
                  <X size={24} />
                </button>
                
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 bg-red-50 dark:bg-red-900/30 rounded-xl flex items-center justify-center text-red-500 shadow-inner">
                    <Flag size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Report Error</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {reportData.questionId ? `Question ID: ${reportData.questionId}` : `Assignment ID: ${reportData.assignmentId}`}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">Issue Type</label>
                    <select 
                      value={reportForm.type}
                      onChange={(e) => setReportForm(prev => ({ ...prev, type: e.target.value }))}
                      className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-red-500 transition-all outline-none"
                    >
                      <option value="error">Factual Error</option>
                      <option value="typo">Typo / Grammar</option>
                      <option value="wrong_answer">Wrong Answer Key</option>
                      <option value="explanation">Unclear Explanation</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">Description</label>
                    <textarea 
                      placeholder="Please describe the issue..."
                      aria-label="Please describe the issue..."
                      value={reportForm.description}
                      onChange={(e) => setReportForm(prev => ({ ...prev, description: e.target.value }))}
                      className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-red-500 transition-all outline-none min-h-[120px] resize-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">Contact (Email or WhatsApp) *</label>
                    <input
                      type="text"
                      placeholder="Your email or WhatsApp number"
                      aria-label="Your email or WhatsApp number"
                      value={reportForm.contact}
                      onChange={(e) => setReportForm(prev => ({ ...prev, contact: e.target.value }))}
                      className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-red-500 transition-all outline-none text-sm"
                    />
                  </div>

                  <button 
                    onClick={handleReportSubmit}
                    disabled={isSubmittingReport || !reportForm.description.trim() || !reportForm.contact.trim()}
                    className="w-full py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSubmittingReport ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        Submit Report
                        <ChevronRight size={18} />
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            </Modal>
          )}

          {/* AI Warning Modal */}
          {showAIWarningModal && (
            <Modal ariaLabel="AI Disclaimer" overlayClassName="z-[70] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white dark:bg-slate-900 rounded-[32px] p-8 max-w-md w-full shadow-2xl border border-indigo-100 dark:border-indigo-900/50 relative z-10"
              >
                <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center text-indigo-500 mb-6 shadow-inner">
                  <Sparkles size={32} />
                </div>
                <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100 mb-4">AI Disclaimer</h2>
                <div className="space-y-4 text-slate-600 dark:text-slate-400 text-sm leading-relaxed mb-8">
                  <p>Artificial Intelligence generates these explanations using advanced language models. While highly capable, AI can sometimes produce inaccurate information or "hallucinations."</p>
                  <p className="font-bold text-indigo-600 dark:text-indigo-400">Please always verify critical medical information with standard textbooks or official guidelines.</p>
                </div>
                <button 
                  onClick={() => {
                    setGlobalState(prev => ({ ...prev, hasSeenAIWarning: true }));
                    setShowAIWarningModal(false);
                  }}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-xl shadow-indigo-200 dark:shadow-indigo-900/50"
                >
                  I Understand, Continue
                </button>
              </motion.div>
            </Modal>
          )}

          {/* Legal Disclaimer Modal */}
          {showDisclaimerModal && (
            <Modal ariaLabel="Legal Disclaimer" overlayClassName="z-[100] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl" />
              <motion.div 
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-slate-900 rounded-[40px] p-8 sm:p-10 max-w-lg w-full shadow-2xl border border-white dark:border-slate-800 relative z-10 max-h-[90vh] overflow-y-auto custom-scrollbar"
              >
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 bg-red-50 dark:bg-red-900/20 rounded-2xl flex items-center justify-center text-red-500">
                    <AlertCircle size={32} />
                  </div>
                  <h2 className="text-3xl font-black text-slate-800 dark:text-slate-100">Legal Disclaimer</h2>
                </div>
                
                <div className="space-y-6 text-slate-600 dark:text-slate-400 text-sm leading-relaxed mb-10">
                  <section>
                    <h3 className="font-black text-slate-800 dark:text-slate-200 uppercase tracking-widest text-[10px] mb-2">Notice to All Users</h3>
                    <p>This application is an educational tool created for study purposes. It is NOT a substitute for professional medical advice, diagnosis, or treatment.</p>
                  </section>
                  
                  <section>
                    <h3 className="font-black text-slate-800 dark:text-slate-200 uppercase tracking-widest text-[10px] mb-2">No Liability</h3>
                    <p>The creator (<a href="https://www.linkedin.com/in/draswanth/" target="_blank" rel="noopener noreferrer" className="font-bold underline decoration-sky-500/30 hover:text-sky-600 transition-colors">Dr. Aswanth Krishnan</a>) and developers shall NOT be held responsible for any errors, omissions, or the results obtained from the use of this information. All information is provided "as is" with no guarantee of completeness, accuracy, or timeliness.</p>
                  </section>

                  <section>
                    <h3 className="font-black text-slate-800 dark:text-slate-200 uppercase tracking-widest text-[10px] mb-2">Intellectual Property</h3>
                    <p>This app may contain copyrighted material, the use of which has not always been specifically authorized by the copyright owner. We are making such material available for educational purposes under "fair use" principles.</p>
                  </section>

                  <section className="p-4 bg-sky-50 dark:bg-sky-900/20 rounded-2xl border border-sky-100 dark:border-sky-800 flex gap-3">
                    <Info size={20} className="text-sky-600 flex-shrink-0" />
                    <p className="text-xs text-sky-800 dark:text-sky-300">By continuing, you agree that you are using this application at your own risk and have read all terms above.</p>
                  </section>
                </div>

                {/* Pinned to the bottom so the button is always fully visible on small screens */}
                <div className="sticky -bottom-8 sm:-bottom-10 -mx-8 sm:-mx-10 -mb-8 sm:-mb-10 px-8 sm:px-10 pt-4 pb-8 sm:pb-10 bg-white dark:bg-slate-900">
                  <button
                    onClick={() => {
                      setGlobalState(prev => ({ ...prev, hasAcceptedDisclaimer: true }));
                      setShowDisclaimerModal(false);
                    }}
                    className="w-full py-5 bg-gradient-to-r from-sky-600 to-indigo-600 text-white rounded-3xl font-black text-lg shadow-2xl shadow-sky-200 dark:shadow-sky-900/50 hover:scale-[1.02] transition-transform active:scale-95"
                  >
                    I Accept & Agree
                  </button>
                </div>
              </motion.div>
            </Modal>
          )}
        </AnimatePresence>
      </main>

      {/* Persistent Global Footer */}
      <footer className="py-6 px-4 text-center border-t border-sky-100/50 dark:border-slate-800/50 bg-white/20 dark:bg-slate-900/20 backdrop-blur-sm">
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
          <button onClick={() => setView('about')} className="hover:text-sky-600 dark:hover:text-sky-400 transition-colors">About Us</button>
          <button onClick={() => setView('privacy')} className="hover:text-sky-600 dark:hover:text-sky-400 transition-colors">Privacy Policy</button>
          <button onClick={() => setView('terms')} className="hover:text-sky-600 dark:hover:text-sky-400 transition-colors">Terms of Service</button>
          <button onClick={() => setView('contact')} className="hover:text-sky-600 dark:hover:text-sky-400 transition-colors">Contact Us</button>
        </div>
        <p className="mt-3 text-[10px] text-slate-400/60 dark:text-slate-600/60 font-bold uppercase tracking-[0.2em]">
          &copy; 2025 BCBR PREP &bull; FREE PAST YEAR QUESTIONS &bull; DR ASWANTH KRISHNAN
        </p>
      </footer>

      {/* Support Developer Modal */}
      <SupportModal
        isOpen={showSupportModal}
        compact={supportModalCompact}
        onExpand={() => setSupportModalCompact(false)}
        onSnooze={snoozeSupportPopup}
        onClose={closeSupportModal}
        upiId={import.meta.env.VITE_SUPPORT_UPI_ID || "aswanthwuhan-2@okhdfcbank"}
        payeeName={import.meta.env.VITE_SUPPORT_PAYEE_NAME || "Dr. Aswanth Krishnan"}
      />
    </div>
  );
}
