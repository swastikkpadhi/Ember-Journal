// Open, optional reflection prompts. No screening, diagnosis, or clinical scoring.
export const QUESTION_VERSION = 1;
export const QUESTION_GROUPS = [
  {
    id: 'arrive', title: 'Arrive as you are', subtitle: 'Before looking back, take one unhurried breath.', icon: 'sun',
    questions: [
      { id: 'day', title: 'How was your day, in your own words?', hint: 'A sentence, a few words, or a whole story. There is no right answer.', placeholder: 'Today felt…' },
      { id: 'feelings', title: 'What feelings visited you today?', hint: 'You can feel several things at once. Where did you notice them in your body?', placeholder: 'I noticed…' },
      { id: 'needs', title: 'How did you care for your basic needs?', hint: 'Think about rest, meals, movement, and moments of quiet, without judging yourself.', placeholder: 'My body needed…' }
    ]
  },
  {
    id: 'bright', title: 'Notice what nourished you', subtitle: 'Good moments can be very small. It is okay if none come to mind.', icon: 'spark',
    questions: [
      { id: 'good', title: 'What good, comforting, or meaningful things happened?', hint: 'A warm drink, an honest conversation, something beautiful, or a moment of relief.', placeholder: 'One moment I want to keep…' },
      { id: 'proud', title: 'What effort would you like to acknowledge?', hint: 'Showing up, setting a boundary, or getting through a difficult hour all count.', placeholder: 'I gave myself credit for…' },
      { id: 'appreciated', title: 'Was there something or someone you appreciated?', hint: 'Appreciation is an invitation, never an obligation. You may leave this blank.', placeholder: 'I appreciated…' }
    ]
  },
  {
    id: 'connections', title: 'The people in your day', subtitle: 'Reflect on connection, company, and the space you needed.', icon: 'people',
    questions: [
      { id: 'people', title: 'Who did you meet, speak with, or think about today?', hint: 'Names are optional. You might describe the relationship or a moment instead.', placeholder: 'I spent time with…' },
      { id: 'connection', title: 'Which interactions left you feeling supported or understood?', hint: 'What about them helped? If you felt alone, what connection would you have liked?', placeholder: 'I felt connected when…' },
      { id: 'boundaries', title: 'Did any interaction leave you needing space or a boundary?', hint: 'Describe your needs rather than assigning blame. You do not have to revisit details.', placeholder: 'I needed…' }
    ]
  },
  {
    id: 'difficult', title: 'Make room for the harder parts', subtitle: 'Go gently. You may skip this entire section.', icon: 'cloud',
    questions: [
      { id: 'hard', title: 'What felt difficult, disappointing, or draining?', hint: 'Share only what feels manageable. You do not need to relive the experience.', placeholder: 'A harder part of today was…' },
      { id: 'thoughts', title: 'Was there a thought that kept returning?', hint: 'Can you notice it as a thought, rather than something you have to solve tonight?', placeholder: 'A thought on my mind…' },
      { id: 'support', title: 'What helped you cope, or what support would help now?', hint: 'A pause, a person, a boundary, practical help, or professional support may come to mind.', placeholder: 'What would help me…' }
    ]
  },
  {
    id: 'close', title: 'Close with kindness', subtitle: 'You do not have to tie the day up neatly.', icon: 'leaf',
    questions: [
      { id: 'values', title: 'When did you act in a way that mattered to you?', hint: 'Perhaps kindness, honesty, curiosity, courage, or looking after yourself.', placeholder: 'Something that mattered to me…' },
      { id: 'kindness', title: 'What would you say to a friend who had your day?', hint: 'Try offering yourself the same understanding, without forcing a positive spin.', placeholder: 'I would tell them…' },
      { id: 'tomorrow', title: 'What is one gentle, realistic intention for tomorrow?', hint: 'Choose something within your influence. Rest can be an intention, too.', placeholder: 'Tomorrow, I would like to…' },
      { id: 'release', title: 'What can you leave here for tonight?', hint: 'You can name an unfinished worry, or simply say that the day is done.', placeholder: 'For tonight, I can let…' }
    ]
  }
];
export const QUESTIONS = QUESTION_GROUPS.flatMap(group => group.questions);
export const DAILY_PROMPTS = [
  'What is one small moment you would like to remember?',
  'What did you need today, and how did you respond?',
  'When did you feel a little more like yourself?',
  'What deserves a kinder interpretation tonight?',
  'What gave you energy, and what asked for it?',
  'What could make tomorrow feel a little more manageable?',
  'What effort can you acknowledge, even if it went unseen?'
];
