exports.processMessageText = (userMessage) => {
  let processedUserMessage = userMessage;

  const doubleTelephoneNumbers = userMessage.matchAll(/<tel:(.*?)\|\1>/g);
  const arrayOfDoubleTelephoneNumbers = Array.from(doubleTelephoneNumbers);
  for (const i in arrayOfDoubleTelephoneNumbers) {
    const oldTelephoneNumber = arrayOfDoubleTelephoneNumbers[i][0];
    const newTelephoneNumber = arrayOfDoubleTelephoneNumbers[i][1];
    processedUserMessage = processedUserMessage.replace(
      oldTelephoneNumber,
      newTelephoneNumber
    );
  }

  const doubleLinks = userMessage.matchAll(/<(.*?)\|\1>/g);
  const arrayOfDoubleLinks = Array.from(doubleLinks);
  for (const i in arrayOfDoubleLinks) {
    const oldLink = arrayOfDoubleLinks[i][0];
    const newLink = arrayOfDoubleLinks[i][1];
    processedUserMessage = processedUserMessage.replace(oldLink, newLink);
  }

  const singleLinks = userMessage.matchAll(/<(.*?)>/g);
  const arrayOfSingleLinks = Array.from(singleLinks);
  for (const i in arrayOfSingleLinks) {
    const oldLink = arrayOfSingleLinks[i][0];
    const newLink = arrayOfSingleLinks[i][1];
    processedUserMessage = processedUserMessage.replace(oldLink, newLink);
  }

  // If nothing was changed, return null. Important for DB logging.
  return userMessage == processedUserMessage ? null : processedUserMessage;
};
