export function STATE_CONFIRMATION(state: string): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTER_HELP_LINE':
      return `Great! We are finding a ${state} volunteer. We try to reply within minutes but may take 24 hours. Meanwhile, please share more about how we can help.`;
    case 'VOTE_FROM_HOME_2020':
      return `Great! We are finding a ${state} volunteer. We try to reply within minutes but may take 24 hours. Meanwhile, please share more about how we can help.`;
    default:
      return `Great! We are finding a ${state} volunteer. We try to reply within minutes but may take 24 hours. Meanwhile, please share more about how we can help.`;
  }
}

export function CLARIFY_STATE(): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTER_HELP_LINE':
      return "I'm sorry I didn't understand. In which U.S. state are you looking to vote? We currently service FL, NC and OH.";
    case 'VOTE_FROM_HOME_2020':
      return "I'm sorry I didn't understand. In which U.S. state are you looking to vote? We currently service MI, NC and PA.";
    default:
      return "I'm sorry I didn't understand. In which U.S. state are you looking to vote? We currently service FL, NC and OH.";
  }
}

export function WELCOME_AND_DISCLAIMER(): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTER_HELP_LINE':
      return 'Welcome to Voter Help Line! We are excited to help you vote.\n\nPlease note that this is not an official or government-affiliated service. Volunteers will do their best to share official links that support their answers to your questions, but by using this service you release Voter Help Line of all liability for your personal voting experience.\n\nReply "agree" to confirm that you understand and would like to continue. (Msg & data rates may apply).';
    case 'VOTE_FROM_HOME_2020':
      return 'Welcome to Voter From Home 2020! We are excited to help you vote.\n\nPlease note that this is not an official or government-affiliated service. Volunteers will do their best to share official links that support their answers to your questions, but by using this service you release Vote From Home of all liability for your personal voting experience.\n\nReply "agree" to confirm that you understand and would like to continue. (Msg & data rates may apply).';
    default:
      return 'Welcome to Voter Help Line! We are excited to help you vote.\n\nPlease note that this is not an official or government-affiliated service. Volunteers will do their best to share official links that support their answers to your questions, but by using this service you release Voter Help Line of all liability for your personal voting experience.\n\nReply "agree" to confirm that you understand and would like to continue. (Msg & data rates may apply).';
  }
}

export const WELCOME_AND_DISCLAIMER_NC =
  'Welcome to Voter Help Line! We are finding an available volunteer -- in the meantime, please tell us more about how we can help you vote. Please note that we currently only service North Carolina. (Msg & data rates may apply).';

export function CLARIFY_DISCLAIMER(): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTER_HELP_LINE':
      return 'To continue, please reply “agree” to confirm that you understand.';
    case 'VOTE_FROM_HOME_2020':
      return 'To continue, please reply “agree” to confirm that you understand.';
    default:
      return 'To continue, please reply “agree” to confirm that you understand.';
  }
}

export function DISCLAIMER_CONFIRMATION_AND_STATE_QUESTION(): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTER_HELP_LINE':
      return 'Great! To match you with the most knowledgeable volunteer, in which U.S. state are you looking to vote? We currently service Florida, North Carolina and Ohio.';
    case 'VOTE_FROM_HOME_2020':
      return 'Great! To match you with the most knowledgeable volunteer, in which U.S. state are you looking to vote? We currently service Michigan, North Carolina and Pennsylvania.';
    default:
      return 'Great! To match you with the most knowledgeable volunteer, in which U.S. state are you looking to vote? We currently service Florida, North Carolina and Ohio.';
  }
}

export function WELCOME_BACK(): string {
  switch (process.env.CLIENT_ORGANIZATION) {
    case 'VOTER_HELP_LINE':
      return `Welcome back! We are connecting you with a volunteer. We will try to reply within a matter of minutes, but depending on the time of day, you might hear back later. In the meantime, please feel free to share more information about your question and situation. (Msg & data rates may apply).`;
    case 'VOTE_FROM_HOME_2020':
      return `Welcome back! We are connecting you with a volunteer. We will try to reply within a matter of minutes, but depending on the time of day, you might hear back later. In the meantime, please feel free to share more information about your question and situation. (Msg & data rates may apply).`;
    default:
      return `Welcome back! We are connecting you with a volunteer. We will try to reply within a matter of minutes, but depending on the time of day, you might hear back later. In the meantime, please feel free to share more information about your question and situation. (Msg & data rates may apply).`;
  }
}
