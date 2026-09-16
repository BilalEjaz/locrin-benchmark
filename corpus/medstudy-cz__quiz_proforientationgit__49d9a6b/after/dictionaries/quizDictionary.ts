export type QuestionType = "multiple-choice" | "multi-select" | "open-ended";

export type Option = string;

export interface Question {
  type: QuestionType;
  question: string;
  options?: Option[];
}

export interface QuestionBankLanguage {
  student: {
    grade_11: Question[];
    bachelor: Question[];
  };
  parent: {
    all: Question[];
  };
}

export interface QuestionBank {
  ua: QuestionBankLanguage;
  ru: QuestionBankLanguage;
  en: QuestionBankLanguage;
}

export const questions: QuestionBank = {
  "ua": {
    "student": {
      "grade_11": [
        {
          "type": "multiple-choice",
          "question": "Який напрям підготовки до іспитів (ЗНО/НМТ) тобі найближчий?",
          "options": [
            "Біологія та хімія",
            "Фізика та математика",
            "Історія та іноземні мови",
            "Математика та географія/англійська"
          ]
        },
        {
          "type": "multiple-choice",
          "question": "Що для тебе найважливіше в майбутньому університеті?",
          "options": [
            "Можливість отримати престижний диплом",
            "Максимум практики та стажувань під час навчання",
            "Сильна наукова база та можливість займатися дослідженнями",
            "Доступна вартість навчання та життя в місті"
          ]
        },
        {
          "type": "open-ended",
          "question": "Яка твоя найбільша мета при вступі до університету за кордоном?"
        }
      ],
      "bachelor": [
        {
          "type": "multiple-choice",
          "question": "Що є головною метою вашого вступу до магістратури?",
          "options": [
            "Поглибити знання у своїй спеціальності для кар'єрного зростання",
            "Змінити спеціальність на більш перспективну",
            "Отримати європейський диплом для роботи в ЄС",
            "Зайнятися науковою діяльністю, вступити на PhD"
          ]
        },
        {
          "type": "multiple-choice",
          "question": "Який формат навчання вам більше підходить?",
          "options": [
            "Практичний, з фокусом на проєктах та стажуваннях",
            "Академічний, з поглибленою теорією та дослідженнями",
            "Комбінований, збалансований формат",
            "Вечірній або заочний, щоб поєднувати з роботою"
          ]
        },
        {
          "type": "open-ended",
          "question": "Опишіть коротко ваш попередній досвід (освіта, робота) та очікування від магістерської програми."
        }
      ]
    },
    "parent": {
      "all": [
        {
          "type": "multiple-choice",
          "question": "Що для вас є головним пріоритетом при виборі освіти для дитини?",
          "options": [
            "Гарантоване працевлаштування після випуску",
            "Престиж університету та якість освіти",
            "Безпека та комфорт проживання в країні",
            "Мінімальні фінансові витрати на навчання та життя"
          ]
        },
        {
          "type": "multiple-choice",
          "question": "Який із цих талантів найяскравіше виражений у вашої дитини?",
          "options": [
            "Емпатія та бажання допомагати іншим",
            "Логічне мислення та любов до техніки",
            "Комунікабельність та гуманітарний склад розуму",
            "Аналітичні здібності та інтерес до бізнесу"
          ]
        },
        {
          "type": "open-ended",
          "question": "Що є вашим найбільшим занепокоєнням щодо вступу дитини за кордон?"
        }
      ]
    }
  },
  "ru": {
    "student": {
      "grade_11": [
        {
          "type": "multiple-choice",
          "question": "Какое направление подготовки к экзаменам (ЗНО/НМТ) тебе ближе всего?",
          "options": [
            "Биология и химия",
            "Физика и математика",
            "История и иностранные языки",
            "Математика и география/английский"
          ]
        },
        {
          "type": "multiple-choice",
          "question": "Что для тебя наиболее важно в будущем университете?",
          "options": [
            "Возможность получить престижный диплом",
            "Максимум практики и стажировок во время учебы",
            "Сильная научная база и возможность заниматься исследованиями",
            "Доступная стоимость обучения и жизни в городе"
          ]
        },
        {
          "type": "open-ended",
          "question": "Какая твоя главная цель при поступлении в университет за границей?"
        }
      ],
      "bachelor": [
        {
          "type": "multiple-choice",
          "question": "Какова главная цель вашего поступления в магистратуру?",
          "options": [
            "Углубить знания в своей специальности для карьерного роста",
            "Сменить специальность на более перспективную",
            "Получить европейский диплом для работы в ЕС",
            "Заняться научной деятельностью, поступить на PhD"
          ]
        },
        {
          "type": "multiple-choice",
          "question": "Какой формат обучения вам больше подходит?",
          "options": [
            "Практический, с фокусом на проектах и стажировках",
            "Академический, с углубленной теорией и исследованиями",
            "Комбинированный, сбалансированный формат",
            "Вечерний или заочный, чтобы совмещать с работой"
          ]
        },
        {
          "type": "open-ended",
          "question": "Кратко опишите ваш предыдущий опыт (образование, работа) и ожидания от магистерской программы."
        }
      ]
    },
    "parent": {
      "all": [
        {
          "type": "multiple-choice",
          "question": "Что для вас главный приоритет при выборе образования для ребенка?",
          "options": [
            "Гарантированное трудоустройство после выпуска",
            "Престиж университета и качество образования",
            "Безопасность и комфорт проживания в стране",
            "Минимальные финансовые расходы на обучение и жизнь"
          ]
        },
        {
          "type": "multiple-choice",
          "question": "Какой из талантов наиболее ярко выражен у вашего ребенка?",
          "options": [
            "Эмпатия и желание помогать другим",
            "Логическое мышление и любовь к технике",
            "Коммуникабельность и гуманитарный склад ума",
            "Аналитические способности и интерес к бизнесу"
          ]
        },
        {
          "type": "open-ended",
          "question": "Что вас больше всего беспокоит в поступлении ребенка за границу?"
        }
      ]
    }
  },
  "en": {
    "student": {
      "grade_11": [
        {
          "type": "multiple-choice",
          "question": "Which exam preparation direction (ZNO/NMT) is closest to you?",
          "options": [
            "Biology and Chemistry",
            "Physics and Mathematics",
            "History and foreign languages",
            "Mathematics and Geography/English"
          ]
        },
        {
          "type": "multiple-choice",
          "question": "What is most important for you in your future university?",
          "options": [
            "The opportunity to get a prestigious diploma",
            "Maximum practice and internships during studies",
            "Strong scientific foundation and opportunity to do research",
            "Affordable tuition and living costs in the city"
          ]
        },
        {
          "type": "open-ended",
          "question": "What is your main goal when applying to a university abroad?"
        }
      ],
      "bachelor": [
        {
          "type": "multiple-choice",
          "question": "What is your main goal in entering a master's program?",
          "options": [
            "Deepen knowledge in your specialty for career growth",
            "Change specialty to a more promising one",
            "Obtain a European diploma to work in the EU",
            "Engage in scientific activity, enroll in a PhD program"
          ]
        },
        {
          "type": "multiple-choice",
          "question": "Which study format suits you best?",
          "options": [
            "Practical, focused on projects and internships",
            "Academic, with deep theory and research",
            "Combined, balanced format",
            "Evening or part-time to combine with work"
          ]
        },
        {
          "type": "open-ended",
          "question": "Briefly describe your previous experience (education, work) and expectations from the master's program."
        }
      ]
    },
    "parent": {
      "all": [
        {
          "type": "multiple-choice",
          "question": "What is your main priority when choosing education for your child?",
          "options": [
            "Guaranteed employment after graduation",
            "University prestige and quality of education",
            "Safety and comfort of living in the country",
            "Minimal financial costs for education and living"
          ]
        },
        {
          "type": "multiple-choice",
          "question": "Which talent is most pronounced in your child?",
          "options": [
            "Empathy and willingness to help others",
            "Logical thinking and love for technology",
            "Communication skills and humanities inclination",
            "Analytical abilities and interest in business"
          ]
        },
        {
          "type": "open-ended",
          "question": "What is your biggest concern about your child's study abroad?"
        }
      ]
    }
  }
};
