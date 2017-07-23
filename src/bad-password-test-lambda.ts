import {
    Callback,
    CloudFormationCustomResourceEvent,
    CloudFormationCustomResourceResponse,
    Context,
} from "aws-lambda";
import * as AWS from "aws-sdk";
import * as SQS from "aws-sdk/clients/sqs";
import {expect} from "chai";
import * as rpn from "request-promise-native";

// tslint:disable-next-line:interface-over-type-literal
type CloudFrontData = { [Key: string]: any; };

function sendCloudFrontResponse(
    event: CloudFormationCustomResourceEvent,
    status: "SUCCESS" | "FAILED",
    physicalResourceId: string,
    error?: string,
    Data?: CloudFrontData,
): Promise<void> {
    let responseBody: CloudFormationCustomResourceResponse;
    if (status === "SUCCESS") {
        responseBody = {
            Status: "SUCCESS",
            PhysicalResourceId: physicalResourceId,
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
            Data,
        };
    } else {
        responseBody = {
            Status: "FAILED",
            PhysicalResourceId: physicalResourceId,
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
            Reason: error,
            Data,
        };
    }
    const responseBodyStr: string = JSON.stringify(responseBody);

    const requestOptions: rpn.OptionsWithUri = {
        method: "PUT",
        uri: event.ResponseURL,
        body: responseBodyStr,
        json: false,
        headers: {
            "content-type": "",
            "content-length": responseBodyStr.length,
        },
    };

    console.log("sendCloudFrontResponse request: " + JSON.stringify(requestOptions));

    return rpn(requestOptions).then((result) => {
        console.log("sendCloudFrontResponse result: " + JSON.stringify(result));
        return;
    });
}

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

function parseParameters(parameters: any[]): any {
    // The parameters get passed in here in the form of an array:
    // [param1=value1, param2=value2]

    const result: any = {};

    if (!Array.isArray(parameters)) {
        throw new Error("Parameters must be an array.");
    }

    parameters.forEach((parameter: string) => {
        console.log("parameter: " + parameter);
        console.log(typeof(parameter));
        const keyValueArray: string[] = parameter.split("=");
        if (keyValueArray.length !== 2) {
            throw new Error("Could not parse parameter key value pair: " + parameter);
        }
        result[keyValueArray[0]] = keyValueArray[1];
    });

    return result;
}

exports.handler = (event: CloudFormationCustomResourceEvent, context: Context, callback: Callback) => {
    console.log("Begin Handler");
    console.log(JSON.stringify(event));

    Promise.resolve().then((): CloudFrontData => {
        if (event.RequestType === "Create") { // What to do on Update?
            const testParameters: any = parseParameters(event.ResourceProperties.Parameters);

            return runTest(testParameters).then(() => {
                console.log("Test Passed.");
                return Promise.resolve({
                    result: JSON.stringify({
                        outcome: "pass",
                    }),
                });
            }).catch((error) => {
                console.log("Test Failed: " + JSON.stringify(error));
                return Promise.resolve({
                    result: JSON.stringify({
                        outcome: "fail",
                        error,
                    }),
                });
            });
        } else {
            return Promise.resolve();
        }
    }).then((cloudFrontData: CloudFrontData) => {
        // TODO: Physical Resource ID
        return sendCloudFrontResponse(event, "SUCCESS", "asdf", "", cloudFrontData).then(() => {
            callback();
        });
    }).catch((error) => {
        console.log("caught error: " + error);
        // TODO: Physical Resource ID
        return sendCloudFrontResponse(event, "FAILED", "asdf", error).catch().then(() => {
            callback(error);
        });
    });
};
