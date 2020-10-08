Both the demo and primary number(s) should be configured to POST to
`https://your-url/twilio-pull`.

You should configure a backup handler (the "Primary handler fails" configuration)
to use this TwiML Bin:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Sorry, there was a problem with our helpline and we weren't able to receive your message. Please try again later. If you're having an urgent issue while trying to vote, please call the National Election Protection Hotline. Their number is 866-OUR-VOTE (866-687-8683).</Message>
</Response>
```
