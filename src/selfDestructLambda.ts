import {
    Callback,
    Context,
} from "aws-lambda";
import * as AWS from "aws-sdk";

function handleTimerEvent(event: any): Promise<void> {
    const cf = new AWS.CloudFormation();

    return cf.deleteStack({StackName: process.env.STACK_ID}).promise().then(() => {
        return;
    });
}

exports.handler = (event: any, context: Context, callback: Callback) => {
    console.log("Begin Handler");
    console.log(JSON.stringify(event));

    Promise.resolve().then(() => {
        return handleTimerEvent(event);
    }).then(() => {
        callback();
    }).catch((error) => {
        callback(error);
    });
};
