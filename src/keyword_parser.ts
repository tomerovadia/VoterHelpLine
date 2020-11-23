export function isHelplineKeyword(userMessage: string): boolean {
  const userMessageNoPunctuation = userMessage
    .toLowerCase()
    .replace(/[^a-zA-Z]/g, '');
  return userMessageNoPunctuation.startsWith('helpline');
}

export function isStopKeyword(userMessage: string): boolean {
  return userMessage.toLowerCase().trim() === 'stop';
}

export function isJoinKeyword(userMessage: string): boolean {
  return userMessage.toLowerCase().trim() === 'join';
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
