export const makeSlackMessageBlockActionPayload = (props = {}) => ({
  // Generic-ish props
  type: 'block_actions',
  user: {
    id: 'U01BGDZHPDM',
    username: 'afong',
    name: 'afong',
    team_id: 'T01CM1QC54Y',
  },
  api_app_id: 'A01BQE9KRNJ',
  token: 'wVHIwZKOFrr1It7ZtpjyxZ3W',
  container: {
    type: 'message',
    message_ts: '1601785422.000500',
    channel_id: 'G01C3FN3WJ0',
    is_ephemeral: false,
    thread_ts: '1601785422.000500',
  },
  trigger_id: '1391457928487.1429058413168.5531bafc21d3fbe7342b17c96db90e89',
  team: { id: 'T01CM1QC54Y', domain: 'voterhelplinedevafong' },
  channel: { id: 'G01C3FN3WJ0', name: 'privategroup' },
  response_url:
    'https://hooks.slack.com/actions/T01CM1QC54Y/1412389922020/DqwJxIuwnBeIlSA1xD7oPGB7',

  // You will probably want to replace these with things specific to your test
  message: {},
  state: {},
  actions: [],

  ...props,
});
