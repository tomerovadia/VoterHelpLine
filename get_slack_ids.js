
const axios = require('axios');

async function listSlackUsers(token) {
  try {
    const response = await axios.get('https://slack.com/api/users.list', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.data.ok) {
      response.data.members.forEach(user => {
        console.log(`User ID: ${user.id}, Name: ${user.name}`);
      });
    } else {
      console.error('Error in API response:', response.data.error);
    }
  } catch (error) {
    console.error('Error fetching users:', error);
  }
}

// Replace 'your-slack-token-here' with your actual Slack bot token
const token = 'xoxp-1263306800675-1263100455362-1444793130838-5935551fd93d9058b792c621a06e44a6';
listSlackUsers(token);
