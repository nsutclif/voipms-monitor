import {Callback, Context} from "aws-lambda";
import {pollVoipms} from "./voipms-monitor";

exports.handler = (event: any, context: Context, callback: Callback) => {
    pollVoipms(
        process.env.USER,
        process.env.PASSWORD,
        process.env.ACCOUNT,
        process.env.AWS_DEFAULT_REGION,
        process.env.ACCOUNT_REGISTRATION_STATUS_TABLE_NAME,
    ).then( () => {
        callback();
    }).catch( (error) => {
        callback(error);
    });
};
