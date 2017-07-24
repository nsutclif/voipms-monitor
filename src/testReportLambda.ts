import {
    Callback,
    CloudFormationCustomResourceEvent,
    CloudFormationCustomResourceResponse,
    Context,
} from "aws-lambda";
import * as AWS from "aws-sdk";
import {PutObjectRequest} from "aws-sdk/clients/s3";
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
            const s3Bucket: string = event.ResourceProperties.S3Bucket;
            const s3Prefix: string = event.ResourceProperties.S3Prefix;

            const testReport = event.ResourceProperties.BadPasswordResults; // TODO!!

            const s3 = new AWS.S3();

            const params: PutObjectRequest = {
                Bucket: s3Bucket,
                Key: [s3Prefix, "testresults.txt"].join("/"),
                Body: testReport,
            };

            console.log("s3 params: " + JSON.stringify(params));

            return s3.putObject(params).promise();
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
