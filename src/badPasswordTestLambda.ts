import {
    Callback,
    Context,
} from "aws-lambda";
import * as AWS from "aws-sdk";
import * as SQS from "aws-sdk/clients/sqs";
import {expect} from "chai";
import * as rpn from "request-promise-native";

function runTest(testParameters: any): Promise<void> {
    const sqs: SQS = new AWS.SQS();

    const requestOptions: SQS.ReceiveMessageRequest = {
        QueueUrl: testParameters.ResultsSQSQueueURL,
        MaxNumberOfMessages: 10,
    };

    console.log("receiveMessage request: " + JSON.stringify(requestOptions));

    return sqs.receiveMessage(requestOptions).promise().then((result: SQS.ReceiveMessageResult) => {
        console.log("receiveMessage result: " + JSON.stringify(result));

        // tslint:disable-next-line:no-unused-expression
        expect(result.Messages).to.exist;
        expect(result.Messages).to.be.an("array");
        expect(result.Messages.length).to.be.greaterThan(0);

        const firstMessage = result.Messages[0];

        expect(firstMessage.Body).to.be.a("string");
        const snsNotification = JSON.parse(firstMessage.Body);

        expect(snsNotification.Type).to.equal("Notification");
        expect(snsNotification.Subject).to.equal("Voip.ms registration status change");
        expect(snsNotification.Message).to.equal("Error checking registration status: invalid_credentials");

        return Promise.resolve();
    });
}

exports.handler = (event: any, context: Context, callback: Callback) => {
    console.log("Begin Handler");
    console.log(JSON.stringify(event));

    Promise.resolve().then(() => {
        return runTest(event);
    }).then(() => {
        callback();
    }).catch((error) => {
        console.log("caught error: " + error);
        callback(error);
    });
};
