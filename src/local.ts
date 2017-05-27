import {pollVoipms} from "./voipms-monitor";

pollVoipms(
    process.env.USER,
    process.env.PASSWORD,
    process.env.ACCOUNT,
    process.env.AWS_DEFAULT_REGION,
    process.env.ACCOUNT_REGISTRATION_STATUS_TABLE_NAME,
).then(() => {
        console.log("Complete");
    }).catch( (error) => {
        console.log(error);
    });
