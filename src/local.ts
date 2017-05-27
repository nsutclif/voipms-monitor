import {pollVoipms} from "./voipms-monitor";

pollVoipms(
    process.env.USER,
    process.env.PASSWORD,
    process.env.ACCOUNT,
    process.env.AWS_DEFAULT_REGION,
    process.env.ACCOUNT_REGISTRATION_STATUS_TABLE_NAME,
    process.env.REGISTRATION_STATUS_CHANGE_TOPIC,
).then(() => {
        console.log("Complete");
    }).catch( (error) => {
        console.log(error);
    });
