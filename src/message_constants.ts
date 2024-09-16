export function STATE_CONFIRMATION(state: string): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTE_AMERICA':
      return `Thanks! We are finding a ${state} volunteer and will be with you shortly. Meanwhile, please share more about how we can help.`;
    case 'VOTE_FROM_HOME_2020':
      return `Great! We are finding a ${state} volunteer and will be with you shortly. Meanwhile, please share more about how we can help.`;
    case 'VOTER_HELP_LINE':
      return `Great! We are finding a ${state} volunteer and will be with you shortly. Meanwhile, please share more about how we can help.`;
    default:
      return `Great! We are finding a ${state} volunteer and will be with you shortly. Meanwhile, please share more about how we can help.`;
  }
}

export function FINDING_VOLUNTEER(): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTE_AMERICA':
      return `We are finding a volunteer and will be with you shortly. Meanwhile, please share more about how we can help.`;
    case 'VOTE_FROM_HOME_2020':
      return `We are finding a volunteer and will be with you shortly. Meanwhile, please share more about how we can help.`;
    case 'VOTER_HELP_LINE':
      return `We are finding a volunteer and will be with you shortly. Meanwhile, please share more about how we can help.`;
    default:
      return `We are finding a volunteer and will be with you shortly. Meanwhile, please share more about how we can help.`;
  }
}

export function CLARIFY_STATE(): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTE_AMERICA':
      return "I'm sorry I didn't understand. In which U.S. state are you looking to vote? Please use your state’s abbreviation.";
    case 'VOTE_FROM_HOME_2020':
      return "I'm sorry I didn't understand. In which U.S. state are you looking to vote? We currently service MI, NC and PA.";
    case 'VOTER_HELP_LINE':
      return "I'm sorry I didn't understand. In which U.S. state are you looking to vote? We currently service FL, NC and OH.";
    default:
      return "I'm sorry I didn't understand. In which U.S. state are you looking to vote? We currently service FL, NC and OH.";
  }
}

export function WELCOME_VOTER(): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTE_AMERICA':
      return "Welcome to VoteAmerica! Msg&data rates may apply.\n\nReply HELPLINE to connect with a trained volunteer, STOP to unsubscribe.";
    case 'VOTE_FROM_HOME_2020':
      return 'Vote From Home 2020 is excited to help you vote!\n\nPlease note this is not an official or government-affiliated service. Volunteers will do their best to share official links that support their answers to your questions, but by using this service you release Vote From Home 2020 of all liability for your personal voting experience.\n\nReply AGREE to confirm that you understand and would like to continue to receive automated text messages from this number with further information. (Msg & data rates may apply). Reply STOP to unsubscribe.';
    case 'VOTER_HELP_LINE':
      return 'Welcome to Voter Help Line! We are excited to help you vote.\n\nPlease note that this is not an official or government-affiliated service. Volunteers will do their best to share official links that support their answers to your questions, but by using this service you release Voter Help Line of all liability for your personal voting experience.\n\nReply AGREE to confirm that you understand and would like to continue. (Msg & data rates may apply).';
    case 'GADEMS':
      return 'Hi! You’ve reached the Georgia Voter Assistance Helpline.\n\nReply HELPLINE to be connected to a volunteer.';
    default:
      return 'Welcome to Voter Help Line! We are excited to help you vote.\n\nPlease note that this is not an official or government-affiliated service. Volunteers will do their best to share official links that support their answers to your questions, but by using this service you release Voter Help Line of all liability for your personal voting experience.\n\nReply AGREE to confirm that you understand and would like to continue. (Msg & data rates may apply).';
  }
}

export function CLARIFY_DISCLAIMER(): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTE_FROM_HOME_2020':
      return 'To continue, please reply AGREE to confirm that you understand.';
    case 'VOTER_HELP_LINE':
      return 'To continue, please reply AGREE to confirm that you understand.';
    default:
      return 'To continue, please reply AGREE to confirm that you understand.';
  }
}

export function CLARIFY_HELPLINE_REQUEST(): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTE_AMERICA':
      return 'Reply HELPLINE to be connected to the helpline, or STOP to opt out of texts.';
    case 'GADEMS':
      return 'Reply HELPLINE to be connected to a volunteer.';
    default:
      return 'Reply HELPLINE to be connected to the helpline, or STOP to opt out of texts.';
  }
}

// Only used by VOTE_AMERICA and GADEMS.
export function WELCOME_AND_STATE_QUESTION(): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTE_AMERICA':
      return 'Welcome to the VoteAmerica Helpline! In which U.S. state are you looking to vote?\n\nMsg&data rates may apply. Reply STOP to unsubscribe.';
    default:
      return 'Welcome to the Voter Helpline! In which U.S. state are you looking to vote?\n\nMsg&data rates may apply. Reply STOP to unsubscribe.';
  }
}

export function WELCOME_FINDING_VOLUNTEER(state: string): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'GADEMS':
      return `Hi! You’ve reached the Georgia Voter Assistance Helpline.\n\nWe are finding a volunteer and will be with you shortly. In the meantime, please share your name and question or concern.`;
    case 'VOTE_AMERICA':
      return `Welcome to the VoteAmerica Helpline! Msg&data rates may apply. Reply STOP to unsubscribe.\n\nWe are finding a volunteer for ${state}. Please share more about how we can help, or let us know if you are looking to vote in a different state.`;
    default:
      return `Welcome to the Voter Helpline! Msg&data rates may apply. Reply STOP to unsubscribe.\n\nWe are finding a volunteer for ${state}. Please share more about how we can help, or let us know if you are looking to vote in a different state.`;
  }
}

export function FINDING_VOLUNTEER_IN_STATE(state: string): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'GADEMS':
      return `We are finding a volunteer and will be with you shortly. In the meantime, please share your name and question or concern.`;
    default:
      return `We are finding a volunteer for ${state} and will be with you shortly. Please share more about how we can help, or let us know if you are looking to vote in a different state.`;
  }
}

export function VOTED_WELCOME_RESPONSE(): string {
  return 'Thank you for voting! Please remind your friends and family to vote too.\n\nReply HELPLINE if you have any questions, or STOP to opt out of texts. Msg&data rates may apply.';
}

export function VOTED_RESPONSE(): string {
  return 'Thank you for voting!';
}

export function HELPLINE_AFTER_STOP_RESPONSE(): string {
  return 'You have previously opted out of VoteAmerica text messages. To access the voter helpline, first text JOIN to resubscribe to VoteAmerica election alerts, and then text HELPLINE again to reach a volunteer. Msg&data rates apply.';
}

export function STATE_QUESTION(): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTE_AMERICA':
      return 'Great! To match you with the most knowledgeable volunteer, in which U.S. state are you looking to vote?';
    case 'VOTE_FROM_HOME_2020':
      return 'Great! To match you with the most knowledgeable volunteer, in which U.S. state are you looking to vote? We currently service Michigan, North Carolina and Pennsylvania.';
    case 'VOTER_HELP_LINE':
      return 'Great! To match you with the most knowledgeable volunteer, in which U.S. state are you looking to vote? We currently service Florida, North Carolina and Ohio.';
    default:
      return 'Great! To match you with the most knowledgeable volunteer, in which U.S. state are you looking to vote? We currently service Florida, North Carolina and Ohio.';
  }
}

export function WELCOME_BACK(): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTE_AMERICA':
      return 'Welcome back! We are connecting you with a volunteer and will be with you shortly. In the meantime, please feel free to share more information about your question and situation.';
    case 'VOTE_FROM_HOME_2020':
      return `Welcome back! We are connecting you with a volunteer and will be with you shortly. In the meantime, please feel free to share more information about your question and situation. (Msg & data rates may apply).`;
    case 'VOTER_HELP_LINE':
      return `Welcome back! We are connecting you with a volunteer and will be with you shortly. In the meantime, please feel free to share more information about your question and situation. (Msg & data rates may apply).`;
    case 'GADEMS':
      return `Welcome back! A volunteer will be with you shortly.`;
    default:
      return `Welcome back! We are connecting you with a volunteer and will be with you shortly. In the meantime, please feel free to share more information about your question and situation. (Msg & data rates may apply).`;
  }
}
