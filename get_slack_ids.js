const axios = require('axios');

async function listSlackUsers(token) {
  try {
    const response = await axios.get('https://slack.com/api/users.list', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.data.ok) {
      response.data.members.forEach((user) => {
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
const token =
  '';
listSlackUsers(token);
