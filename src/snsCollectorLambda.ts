import {
    Callback,
    CloudFormationCustomResourceCreateEvent,
    CloudFormationCustomResourceDeleteEvent,
    CloudFormationCustomResourceEvent,
    CloudFormationCustomResourceResponse,
    Context,
    SNSEvent,
} from "aws-lambda";
import * as AWS from "aws-sdk";
import {
    DocumentClient,
    PutItemInput,
    PutItemOutput,
    UpdateItemInput,
    UpdateItemOutput,
} from "aws-sdk/clients/dynamodb";
import * as rpn from "request-promise-native";

function sendCloudFrontResponse(
    event: CloudFormationCustomResourceEvent,
    status: "SUCCESS" | "FAILED",
    physicalResourceId: string,
    error?: string,
): Promise<void> {
    let responseBody: CloudFormationCustomResourceResponse;
    if (status === "SUCCESS") {
        responseBody = {
            Status: "SUCCESS",
            PhysicalResourceId: physicalResourceId,
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
        };
    } else {
        responseBody = {
            Status: "FAILED",
            PhysicalResourceId: physicalResourceId,
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
            Reason: error,
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

function handleCloudFormationResourceEvent(event: CloudFormationCustomResourceEvent): Promise<void> {
    if ((event as CloudFormationCustomResourceCreateEvent).RequestType === "Create") {
        // Save all the great info into Dynamo for later
        const documentClient: DocumentClient = new AWS.DynamoDB.DocumentClient();

        // requestParams hould be a GetItemInput but there's something strange about the typedef of GetItemInput
        // that TypeScript 2.4.1 complains about
        const requestParams: any = {
            TableName: process.env.COUNT_TABLE,
            Item: {
                collector: process.env.TOPIC_ARN,
                messageCount: 0,
                createEvent: event,
            },
        };

        return documentClient.put(requestParams).promise().then((result: PutItemOutput) => {
            return Promise.resolve();
        });
    } else if ((event as CloudFormationCustomResourceDeleteEvent).RequestType === "Delete") {
        // Nothing to delete.  Just tell CloudFormation we're done.
        return sendCloudFrontResponse(
            event,
            "SUCCESS",
            (event as CloudFormationCustomResourceDeleteEvent).PhysicalResourceId,
        );
    } else {
        // We will tell CloudFormation we're done when we get the messages in that we're waiting for.
        return Promise.resolve();
    }

}

function getMessageCount(): Promise<number> {
    return Promise.resolve(0);
}

function handleSNSEvent(event: SNSEvent): Promise<void> {
    const documentClient: DocumentClient = new AWS.DynamoDB.DocumentClient();

    // requestParams hould be a UpdateItemInput but there's something strange about the typedef of UpdateItemInput
    // that TypeScript 2.4.1 complains about
    const requestParams: any = {
        TableName: process.env.COUNT_TABLE,
        Key: { collector: process.env.TOPIC_ARN },
        UpdateExpression: "SET messageCount = messageCount + :increment",
        ExpressionAttributeValues: {
            ":increment": 1,
        },
    };

    console.log("Dynamo Request: " + JSON.stringify(requestParams));

    return documentClient.update(requestParams).promise().then((updatedItem: UpdateItemOutput) => {
        console.log("Dynamo Response: " + JSON.stringify(updatedItem));

        // createEvent = updatedItem

        // TODO: More logic here!
        // return sendCloudFrontResponse();
        return Promise.resolve();
    });
}

exports.handler = (event: any, context: Context, callback: Callback) => {
    console.log("Begin Handler");
    console.log(JSON.stringify(event));

    // TODO:
    // Pass a unique string into t his function for a physical id.
    // Allow this function to be called with a CloudFormationCustomResourceEvent or an SNSEvent or a timer event

    Promise.resolve().then(() => {
        if (event.ServiceToken) {
            return handleCloudFormationResourceEvent(event);
        } else if (event.Records) {
            return handleSNSEvent(event);
        } else {
            return Promise.reject("Unexpected Lambda Event");
        }
    }).then(() => {
        callback();
        return;
    }).catch( (error) => {
        // TODO: Rethink error handling for this function.  Should we fail the CloudFront resource if we get an
        // error handling an SNS message?  We'd only be able to do so if we were able to read from Dynamo and
        // get the details to communicate with CloudFront.
        return sendCloudFrontResponse(event, "FAILED", "", error).catch().then(() => {
            callback(error);
        });
    });
};
