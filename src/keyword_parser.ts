export function isHelplineKeyword(userMessage: string): boolean {
    const userMessageNoPunctuation = userMessage
        .toLowerCase()
        .replace(/[^a-zA-Z]/g, '');
    return userMessageNoPunctuation.startsWith('helpline');
}


export function isStopKeyword(userMessage: string): boolean {
    return userMessage.toLowerCase().trim() === 'stop'
}