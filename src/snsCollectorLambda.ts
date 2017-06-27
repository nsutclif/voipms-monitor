import {
    Callback,
    CloudFormationCustomResourceDeleteEvent,
    CloudFormationCustomResourceEvent,
    CloudFormationCustomResourceResponse,
    Context,
} from "aws-lambda";
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
            Status: status,
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
    if ((event as CloudFormationCustomResourceDeleteEvent).RequestType === "Delete") {
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

exports.handler = (event: any, context: Context, callback: Callback) => {
    console.log("Begin Handler");
    console.log(JSON.stringify(event));

    // TODO:
    // Pass a unique string into t his function for a physical id.
    // Allow this function to be called with a CloudFormationCustomResourceEvent or an SNSEvent or a timer event

    Promise.resolve().then(() => {
        if (event.ServiceToken) {
            return handleCloudFormationResourceEvent(event);
        } else {
            return Promise.reject("Unexpected Lambda Event");
        }
    }).then(() => {
        callback();
        return;
    }).catch( (error) => {
        return sendCloudFrontResponse(event, "FAILED", "", error).catch().then(() => {
            callback(error);
        });
    });
};
