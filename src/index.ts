import {Callback, Context} from "aws-lambda";
import {pollVoipms} from "./voipms-monitor";

exports.handler = (event: any, context: Context, callback: Callback) => {
    pollVoipms(process.env.USER, process.env.PASSWORD, process.env.ACCOUNT).then( () => {
        callback();
    }).catch( (error) => {
        callback(error);
    });
};
