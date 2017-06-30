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
    GetItemOutput,
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

function setUpDynamoRecord(event: CloudFormationCustomResourceCreateEvent): Promise<void> {
    // Save all the great info into Dynamo for later
    const documentClient: DocumentClient = new AWS.DynamoDB.DocumentClient();

    // requestParams should be a PutItemInput but there's something strange about the typedef of PutItemInput
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
}

function handleTimeout(
    originalCreateEvent: CloudFormationCustomResourceCreateEvent,
    physicalResourceId: string,
    messagesReceived: number,
): Promise<void> {
    const minimumMessageToCollect: number =
        Number(originalCreateEvent.ResourceProperties.MinimumMessagesToCollect) || 0;

    // TODO: Add a FailOnTimeout parameter?

    if (minimumMessageToCollect === 0) {
        return sendCloudFrontResponse(originalCreateEvent, "SUCCESS", physicalResourceId);
    } else {
        return sendCloudFrontResponse(originalCreateEvent,
            "FAILED",
            physicalResourceId,
            "Expected to collect " + minimumMessageToCollect + " messages but only collected " + messagesReceived,
        );
    }
}

function handleCloudFormationResourceEvent(event: CloudFormationCustomResourceEvent): Promise<void> {
    return Promise.resolve().then(() => {
        if ((event as CloudFormationCustomResourceCreateEvent).RequestType === "Create") {
            const minimumMessageToCollect: number = Number(event.ResourceProperties.MinimumMessagesToCollect) || 0;
            const maximumMinutesToWait: number = Number(event.ResourceProperties.MaximumMinutesToWait) || 0;

            if (minimumMessageToCollect === 0) {
                // Nothing to wait for, we're done...
                return sendCloudFrontResponse(
                    event,
                    "SUCCESS",
                    getPhysicalResourceID(event as CloudFormationCustomResourceCreateEvent),
                );
            } else if ( maximumMinutesToWait === 0 ) {
                // we've already timed out!
                return handleTimeout(
                    event as CloudFormationCustomResourceCreateEvent,
                    getPhysicalResourceID(event as CloudFormationCustomResourceCreateEvent),
                    0,
                );
            }
            return setUpDynamoRecord(event as CloudFormationCustomResourceCreateEvent);
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
    }).catch((error) => {
        return sendCloudFrontResponse(event, "FAILED", "", error).then(() => {
            return Promise.reject(error);
        });
    });
}

function getPhysicalResourceID(createEvent: CloudFormationCustomResourceCreateEvent) {
    return [createEvent.StackId, createEvent.LogicalResourceId].join("/");
}

function handleSNSEvent(event: SNSEvent): Promise<void> {
    const documentClient: DocumentClient = new AWS.DynamoDB.DocumentClient();

    // requestParams should be a UpdateItemInput but there's something strange about the typedef of UpdateItemInput
    // that TypeScript 2.4.1 complains about
    const requestParams: any = {
        TableName: process.env.COUNT_TABLE,
        Key: { collector: process.env.TOPIC_ARN },
        UpdateExpression: "SET messageCount = messageCount + :increment",
        ExpressionAttributeValues: {
            ":increment": 1,
        },
        ReturnValues: "ALL_NEW",
    };

    console.log("Dynamo Request: " + JSON.stringify(requestParams));

    return documentClient.update(requestParams).promise().then((updatedItem: UpdateItemOutput) => {
        console.log("Dynamo Response: " + JSON.stringify(updatedItem));

        const originalCreateEvent: CloudFormationCustomResourceCreateEvent =
            updatedItem.Attributes.createEvent as CloudFormationCustomResourceCreateEvent;

        const minimumMessagesToCollect: number =
            Number(originalCreateEvent.ResourceProperties.MinimumMessagesToCollect);

        if (updatedItem.Attributes.messageCount === minimumMessagesToCollect) {
            return sendCloudFrontResponse(originalCreateEvent, "SUCCESS", getPhysicalResourceID(originalCreateEvent));
        } else {
            return Promise.resolve();
        }
    });
}

function handleTimerEvent(event: any): Promise<void> {
    const documentClient: DocumentClient = new AWS.DynamoDB.DocumentClient();

    // requestParams should be a GetItemInput but there's something strange about the typedef of GetItemInput
    // that TypeScript 2.4.1 complains about
    const requestParams: any = {
        TableName: process.env.COUNT_TABLE,
        Key: { collector: process.env.TOPIC_ARN },
    };

    console.log("Dynamo Request: " + JSON.stringify(requestParams));

    return documentClient.get(requestParams).promise().then((getItemOutput: GetItemOutput) => {
        console.log("Dynamo Response: " + JSON.stringify(getItemOutput));

        if (getItemOutput.Item) {
            const originalCreateEvent: CloudFormationCustomResourceCreateEvent =
                getItemOutput.Item.createEvent as CloudFormationCustomResourceCreateEvent;
            const messageCount: number = Number(getItemOutput.Item.messageCount);

            return handleTimeout(originalCreateEvent, getPhysicalResourceID(originalCreateEvent), messageCount);
        } else {
            return Promise.reject("Timer event recieved before DynamoDB record saved!");
        }
    });
}

exports.handler = (event: any, context: Context, callback: Callback) => {
    console.log("Begin Handler");
    console.log(JSON.stringify(event));

    // TODO:
    // Pass a unique string into this function for a physical id.
    // Allow this function to be called with a CloudFormationCustomResourceEvent or an SNSEvent or a timer event

    Promise.resolve().then(() => {
        if (event.ServiceToken) {
            return handleCloudFormationResourceEvent(event);
        } else if (event.Records) {
            return handleSNSEvent(event);
        } else if (event.source) {
            return handleTimerEvent(event);
        } else {
            return Promise.reject("Unexpected Lambda Event");
        }
    }).then(() => {
        callback();
    }).catch((error) => {
        callback(error);
    });
};
