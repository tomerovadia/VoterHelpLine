exports.processMessageText = (userMessage) => {
  const doubleLinks = userMessage.matchAll(/\<(.*?)\|\1\>/g);
  const arrayOfDoubleLinks = Array.from(doubleLinks);

  let processedUserMessage = userMessage;
  for (const i in arrayOfDoubleLinks) {
    const from = arrayOfDoubleLinks[i][0];
    const to = arrayOfDoubleLinks[i][1];
    processedUserMessage = processedUserMessage.replace(from, to);
  }

  const singleLinks = userMessage.matchAll(/\<(.*?)\>/g);
  const arrayOfSingleLinks = Array.from(singleLinks);

  for (const i in arrayOfSingleLinks) {
    const from = arrayOfSingleLinks[i][0];
    const to = arrayOfSingleLinks[i][1];
    processedUserMessage = processedUserMessage.replace(from, to);
  }

  return userMessage == processedUserMessage ? null : processedUserMessage;
};
