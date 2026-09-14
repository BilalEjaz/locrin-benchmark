export type QuestionType = "multiple-choice" | "open-ended";

export interface Option {
  answers: string[];
  tags: string[];
}

export interface Question {
  type: QuestionType;
  question: string;
  options?: Option[];
}

export interface QuestionSet {
  [key: string]: Question[];
}

export interface QuestionBankLanguage {
  student: {
    grade_9: Question[];
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
  ua: {
    student: {
      grade_9: [
        {
          type: "multiple-choice",
          question: "Що тобі найцікавіше вивчати?",
          options: [
            { answers: ["Як влаштований світ і природа (біологія, хімія)"], tags: ["NAT", "MED"] },
            { answers: ["Як працюють технології та комп'ютери (інформатика, фізика)"], tags: ["TECH"] },
            { answers: ["Як взаємодіють люди та суспільство (історія, мови, право)"], tags: ["HUM"] },
            { answers: ["Як працюють гроші та бізнес (математика, економіка)"], tags: ["ECO", "TECH"] }
          ]
        },
        {
          type: "multiple-choice",
          question: "Який тип завдань тобі до душі?",
          options: [
            { answers: ["Допомагати людям, вирішувати їхні проблеми"], tags: ["MED", "HUM"] },
            { answers: ["Створювати щось нове: програми, механізми, дизайн"], tags: ["TECH"] },
            { answers: ["Аналізувати інформацію, писати тексти, вивчати мови"], tags: ["HUM"] },
            { answers: ["Організовувати процеси, керувати командою, рахувати"], tags: ["ECO"] }
          ]
        },
        {
          type: "open-ended",
          question: "Уяви свою роботу через 10 років. Опиши одним реченням, чим ти займаєшся?"
        }
      ],
      grade_11: [
        {
          type: "multiple-choice",
          question: "Який напрям підготовки до іспитів (ЗНО/НМТ) тобі найближчий?",
          options: [
            { answers: ["Біологія та хімія"], tags: ["MED", "NAT"] },
            { answers: ["Фізика та математика"], tags: ["TECH"] },
            { answers: ["Історія та іноземні мови"], tags: ["HUM"] },
            { answers: ["Математика та географія/англійська"], tags: ["ECO"] }
          ]
        },
        {
          type: "multiple-choice",
          question: "Що для тебе найважливіше в майбутньому університеті?",
          options: [
            { answers: ["Можливість отримати престижний диплом"], tags: ["HUM"] },
            { answers: ["Максимум практики та стажувань під час навчання"], tags: ["TECH", "ECO"] },
            { answers: ["Сильна наукова база та можливість займатися дослідженнями"], tags: ["MED", "NAT"] },
            { answers: ["Доступна вартість навчання та життя в місті"], tags: [] }
          ]
        },
        {
          type: "open-ended",
          question: "Яка твоя найбільша мета при вступі до університету за кордоном?"
        }
      ],
      bachelor: [
        {
          type: "multiple-choice",
          question: "Що є головною метою вашого вступу до магістратури?",
          options: [
            { answers: ["Поглибити знання у своїй спеціальності для кар'єрного зростання"], tags: [] },
            { answers: ["Змінити спеціальність на більш перспективну"], tags: ["TECH", "ECO"] },
            { answers: ["Отримати європейський диплом для роботи в ЄС"], tags: [] },
            { answers: ["Зайнятися науковою діяльністю, вступити на PhD"], tags: ["MED", "NAT"] }
          ]
        },
        {
          type: "multiple-choice",
          question: "Який формат навчання вам більше підходить?",
          options: [
            { answers: ["Практичний, з фокусом на проєктах та стажуваннях"], tags: ["TECH", "ECO"] },
            { answers: ["Академічний, з поглибленою теорією та дослідженнями"], tags: ["MED", "NAT"] },
            { answers: ["Комбінований, збалансований формат"], tags: [] },
            { answers: ["Вечірній або заочний, щоб поєднувати з роботою"], tags: [] }
          ]
        },
        {
          type: "open-ended",
          question: "Опишіть коротко ваш попередній досвід (освіта, робота) та очікування від магістерської програми."
        }
      ]
    },
    parent: {
      all: [
        {
          type: "multiple-choice",
          question: "Що для вас є головним пріоритетом при виборі освіти для дитини?",
          options: [
            { answers: ["Гарантоване працевлаштування після випуску"], tags: ["TECH", "ECO"] },
            { answers: ["Престиж університету та якість освіти"], tags: ["HUM", "MED"] },
            { answers: ["Безпека та комфорт проживання в країні"], tags: [] },
            { answers: ["Мінімальні фінансові витрати на навчання та життя"], tags: [] }
          ]
        },
        {
          type: "multiple-choice",
          question: "Який із цих талантів найяскравіше виражений у вашої дитини?",
          options: [
            { answers: ["Емпатія та бажання допомагати іншим"], tags: ["MED", "HUM"] },
            { answers: ["Логічне мислення та любов до техніки"], tags: ["TECH"] },
            { answers: ["Комунікабельність та гуманітарний склад розуму"], tags: ["HUM"] },
            { answers: ["Аналітичні здібності та інтерес до бізнесу"], tags: ["ECO"] }
          ]
        },
        {
          type: "open-ended",
          question: "Що є вашим найбільшим занепокоєнням щодо вступу дитини за кордон?"
        }
      ]
    }

  },

  ru: {
    student: {
      grade_9: [
        {
          type: "multiple-choice",
          question: "Что тебе интереснее всего изучать?",
          options: [
            { answers: ["Как устроен мир и природа (биология, химия)"], tags: ["NAT", "MED"] },
            { answers: ["Как работают технологии и компьютеры (информатика, физика)"], tags: ["TECH"] },
            { answers: ["Как взаимодействуют люди и общество (история, языки, право)"], tags: ["HUM"] },
            { answers: ["Как работают деньги и бизнес (математика, экономика)"], tags: ["ECO", "TECH"] }
          ]
        },
        {
          type: "multiple-choice",
          question: "Какой тип заданий тебе больше нравится?",
          options: [
            { answers: ["Помогать людям, решать их проблемы"], tags: ["MED", "HUM"] },
            { answers: ["Создавать что-то новое: программы, механизмы, дизайн"], tags: ["TECH"] },
            { answers: ["Анализировать информацию, писать тексты, изучать языки"], tags: ["HUM"] },
            { answers: ["Организовывать процессы, управлять командой, считать"], tags: ["ECO"] }
          ]
        },
        {
          type: "open-ended",
          question: "Представь свою работу через 10 лет. Опиши одним предложением, чем ты занимаешься."
        }
      ],
      grade_11: [
        {
          type: "multiple-choice",
          question: "Какое направление подготовки к экзаменам (ЗНО/НМТ) тебе ближе всего?",
          options: [
            { answers: ["Биология и химия"], tags: ["MED", "NAT"] },
            { answers: ["Физика и математика"], tags: ["TECH"] },
            { answers: ["История и иностранные языки"], tags: ["HUM"] },
            { answers: ["Математика и география/английский"], tags: ["ECO"] }
          ]
        },
        {
          type: "multiple-choice",
          question: "Что для тебя наиболее важно в будущем университете?",
          options: [
            { answers: ["Возможность получить престижный диплом"], tags: ["HUM"] },
            { answers: ["Максимум практики и стажировок во время учебы"], tags: ["TECH", "ECO"] },
            { answers: ["Сильная научная база и возможность заниматься исследованиями"], tags: ["MED", "NAT"] },
            { answers: ["Доступная стоимость обучения и жизни в городе"], tags: [] }
          ]
        },
        {
          type: "open-ended",
          question: "Какая твоя главная цель при поступлении в университет за границей?"
        }
      ],
      bachelor: [
        {
          type: "multiple-choice",
          question: "Какова главная цель вашего поступления в магистратуру?",
          options: [
            { answers: ["Углубить знания в своей специальности для карьерного роста"], tags: [] },
            { answers: ["Сменить специальность на более перспективную"], tags: ["TECH", "ECO"] },
            { answers: ["Получить европейский диплом для работы в ЕС"], tags: [] },
            { answers: ["Заняться научной деятельностью, поступить на PhD"], tags: ["MED", "NAT"] }
          ]
        },
        {
          type: "multiple-choice",
          question: "Какой формат обучения вам больше подходит?",
          options: [
            { answers: ["Практический, с фокусом на проектах и стажировках"], tags: ["TECH", "ECO"] },
            { answers: ["Академический, с углубленной теорией и исследованиями"], tags: ["MED", "NAT"] },
            { answers: ["Комбинированный, сбалансированный формат"], tags: [] },
            { answers: ["Вечерний или заочный, чтобы совмещать с работой"], tags: [] }
          ]
        },
        {
          type: "open-ended",
          question: "Кратко опишите ваш предыдущий опыт (образование, работа) и ожидания от магистерской программы."
        }
      ]
    },
    parent: {
      all: [
        {
          type: "multiple-choice",
          question: "Что для вас главный приоритет при выборе образования для ребенка?",
          options: [
            { answers: ["Гарантированное трудоустройство после выпуска"], tags: ["TECH", "ECO"] },
            { answers: ["Престиж университета и качество образования"], tags: ["HUM", "MED"] },
            { answers: ["Безопасность и комфорт проживания в стране"], tags: [] },
            { answers: ["Минимальные финансовые расходы на обучение и жизнь"], tags: [] }
          ]
        },
        {
          type: "multiple-choice",
          question: "Какой из талантов наиболее ярко выражен у вашего ребенка?",
          options: [
            { answers: ["Эмпатия и желание помогать другим"], tags: ["MED", "HUM"] },
            { answers: ["Логическое мышление и любовь к технике"], tags: ["TECH"] },
            { answers: ["Коммуникабельность и гуманитарный склад ума"], tags: ["HUM"] },
            { answers: ["Аналитические способности и интерес к бизнесу"], tags: ["ECO"] }
          ]
        },
        {
          type: "open-ended",
          question: "Что вас больше всего беспокоит в поступлении ребенка за границу?"
        }
      ]
    }
  },

  en: {
    student: {
      grade_9: [
        {
          type: "multiple-choice",
          question: "What are you most interested in studying?",
          options: [
            { answers: ["How the world and nature work (biology, chemistry)"], tags: ["NAT", "MED"] },
            { answers: ["How technology and computers work (IT, physics)"], tags: ["TECH"] },
            { answers: ["How people and society interact (history, languages, law)"], tags: ["HUM"] },
            { answers: ["How money and business work (math, economics)"], tags: ["ECO", "TECH"] }
          ]
        },
        {
          type: "multiple-choice",
          question: "What type of tasks do you enjoy the most?",
          options: [
            { answers: ["Helping people, solving problems"], tags: ["MED", "HUM"] },
            { answers: ["Creating something new: programs, mechanisms, design"], tags: ["TECH"] },
            { answers: ["Analyzing information, writing texts, learning languages"], tags: ["HUM"] },
            { answers: ["Organizing processes, managing a team, calculating"], tags: ["ECO"] }
          ]
        },
        {
          type: "open-ended",
          question: "Imagine your job in 10 years. Describe in one sentence what you do."
        }
      ],
      grade_11: [
        {
          type: "multiple-choice",
          question: "Which exam preparation direction (ZNO/NMT) is closest to you?",
          options: [
            { answers: ["Biology and Chemistry"], tags: ["MED", "NAT"] },
            { answers: ["Physics and Mathematics"], tags: ["TECH"] },
            { answers: ["History and foreign languages"], tags: ["HUM"] },
            { answers: ["Mathematics and Geography/English"], tags: ["ECO"] }
          ]
        },
        {
          type: "multiple-choice",
          question: "What is most important for you in your future university?",
          options: [
            { answers: ["The opportunity to get a prestigious diploma"], tags: ["HUM"] },
            { answers: ["Maximum practice and internships during studies"], tags: ["TECH", "ECO"] },
            { answers: ["Strong scientific foundation and opportunity to do research"], tags: ["MED", "NAT"] },
            { answers: ["Affordable tuition and living costs in the city"], tags: [] }
          ]
        },
        {
          type: "open-ended",
          question: "What is your main goal when applying to a university abroad?"
        }
      ],
      bachelor: [
        {
          type: "multiple-choice",
          question: "What is your main goal in entering a master's program?",
          options: [
            { answers: ["Deepen knowledge in your specialty for career growth"], tags: [] },
            { answers: ["Change specialty to a more promising one"], tags: ["TECH", "ECO"] },
            { answers: ["Obtain a European diploma to work in the EU"], tags: [] },
            { answers: ["Engage in scientific activity, enroll in a PhD program"], tags: ["MED", "NAT"] }
          ]
        },
        {
          type: "multiple-choice",
          question: "Which study format suits you best?",
          options: [
            { answers: ["Practical, focused on projects and internships"], tags: ["TECH", "ECO"] },
            { answers: ["Academic, with deep theory and research"], tags: ["MED", "NAT"] },
            { answers: ["Combined, balanced format"], tags: [] },
            { answers: ["Evening or part-time to combine with work"], tags: [] }
          ]
        },
        {
          type: "open-ended",
          question: "Briefly describe your previous experience (education, work) and expectations from the master's program."
        }
      ]
    },
    parent: {
      all: [
        {
          type: "multiple-choice",
          question: "What is your main priority when choosing education for your child?",
          options: [
            { answers: ["Guaranteed employment after graduation"], tags: ["TECH", "ECO"] },
            { answers: ["University prestige and quality of education"], tags: ["HUM", "MED"] },
            { answers: ["Safety and comfort of living in the country"], tags: [] },
            { answers: ["Minimal financial costs for education and living"], tags: [] }
          ]
        },
        {
          type: "multiple-choice",
          question: "Which talent is most pronounced in your child?",
          options: [
            { answers: ["Empathy and willingness to help others"], tags: ["MED", "HUM"] },
            { answers: ["Logical thinking and love for technology"], tags: ["TECH"] },
            { answers: ["Communication skills and humanities inclination"], tags: ["HUM"] },
            { answers: ["Analytical abilities and interest in business"], tags: ["ECO"] }
          ]
        },
        {
          type: "open-ended",
          question: "What is your biggest concern about your child's study abroad?"
        }
      ]
    }
  }
};
