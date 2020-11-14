export function isHelplineKeyword(userMessage: string): boolean {
  const userMessageNoPunctuation = userMessage
    .toLowerCase()
    .replace(/[^a-zA-Z]/g, '');
  return userMessageNoPunctuation.startsWith('helpline');
}

export function isStopKeyword(userMessage: string): boolean {
  const userMessageSanitized = userMessage
    .toLowerCase()
    .trim()
    .replace(/[^a-zA-Z]/g, '');

  // Catches a one-word message that is simply STOP (including any case, catching e.g. Stop),
  // and disregarding punctuation (catching e.g. STOP!!!).
  return userMessageSanitized === 'stop';
}

export function isVotedKeyword(userMessage: string): boolean {
  return [
    'voted',
    'i voted',
    'already voted',
    'i already voted',
    'ive already voted',
    'i voted already',
    'ive voted already',
  ].includes(
    userMessage
      .toLowerCase()
      .replace(/[^a-zA-Z ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
