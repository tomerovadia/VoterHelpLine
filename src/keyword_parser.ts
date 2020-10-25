export function isHelplineKeyword(userMessage: string): boolean {
  const userMessageSanitized = userMessage
    .toLowerCase()
    .replace(/[^a-zA-Z]/g, '');
  return userMessageSanitized.startsWith('helpline');
}

export function containsStopKeyword(userMessage: string): boolean {
  const userMessageTrimmedNoPunctuation = userMessage
    .trim()
    .replace(/[^a-zA-Z\s]/g, '');

  // Catches a one-word message that is simply STOP (including any case, catching e.g. Stop),
  // and disregarding punctuation (catching e.g. STOP!!!).
  const isStopAnyCase =
    userMessageTrimmedNoPunctuation.toLowerCase().replace(/\s/g, '') === 'stop';

  // Important: Unlike the above parsing, this one does not remove spaces.
  // It also preserves case.
  // Catches a message that contains STOP in all uppercase even in the context
  // of a longer message.
  const containsStopUppercase = userMessageTrimmedNoPunctuation
    .split(' ')
    .includes('STOP');

  return isStopAnyCase || containsStopUppercase;
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
