import {
    Callback,
    CloudFormationCustomResourceEvent,
    CloudFormationCustomResourceResponse,
    Context,
} from "aws-lambda";
import * as AWS from "aws-sdk";
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

// TODO: Type return value
function invokeTest(testName: string, functionName: string, testParameters: any): Promise<any> {
    const lambda = new AWS.Lambda();

    const invokeParams: AWS.Lambda.Types.InvocationRequest = {
        FunctionName: functionName,
        Payload: JSON.stringify(testParameters),
    };

    console.log("invokeParams: " + JSON.stringify(invokeParams));

    return lambda.invoke(invokeParams).promise().then((response: AWS.Lambda.InvocationResponse) => {
        console.log("invoke Response: " + JSON.stringify(response));

        // When the function returns an error, response.FunctionError==="Handled"
        if (response.FunctionError) {
            return Promise.resolve({
                testName,
                outcome: "fail",
                detail: response.Payload,
            });
        } else {
            return Promise.resolve({
                testName,
                outcome: "pass",
                detail: response.Payload,
            });
        }
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

            const testFunctionName: string = event.ResourceProperties.Function;

            return invokeTest(event.LogicalResourceId, testFunctionName, testParameters);
        } else {
            return Promise.resolve();
        }
    }).then((result: any) => { // TODO: Typedef!
        // TODO: Physical Resource ID
        const resultObject: CloudFrontData = {Result: JSON.stringify(result)};
        return sendCloudFrontResponse(event, "SUCCESS", "asdf", "", resultObject).then(() => {
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
