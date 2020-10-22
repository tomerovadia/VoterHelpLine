const VOTED_KEYWORDS = [
  'voted',
  'i voted',
  'already voted',
  'i already voted',
  "i've already voted",
  'i voted already',
  "i've voted already",
];

export function isHelplineKeyword(userMessage: string): boolean {
  const userMessageNoPunctuation = userMessage
    .toLowerCase()
    .replace(/[^a-zA-Z]/g, '');
  return userMessageNoPunctuation.startsWith('helpline');
}

export function isStopKeyword(userMessage: string): boolean {
  return userMessage.toLowerCase().trim() === 'stop';
}

export function isVotedKeyword(userMessage: string): boolean {
  return VOTED_KEYWORDS.includes(userMessage.toLowerCase().trim());
}
