import {Callback, Context} from "aws-lambda";
import * as rpn from "request-promise-native";

interface CustomResourceEvent {
    RequestType: "Create" | "Update" | "Delete";
    ResponseURL: string;
    StackId: string;
    RequestId: string;
    ResourceType: string;
    LogicalResourceId: string;
    PhysicalResourceId?: string;
    ResourceProperties: {[key: string]: string};
    OldResourceProperties?: {[key: string]: string};
}

interface CustomResourceResponse {
    Status: "SUCCESS" | "FAILED";
    Reason?: string;
    PhysicalResourceId: string;
    StackId: string;
    RequestId: string;
    LogicalResourceId: string;
    Data?: {[key: string]: string};
}

interface StatusParams {
    repo: string;
    context: string;
    gitHubToken: string;
    commitHash: string;
    state: string;
}

function gitHubErrorToString(error): string {
    let errorString: string = "Error contacting GitHub";
    // error seems to be a JSON but doens't always seem to have the same structure.
    if (error.error) {
        if (error.error.message) {
            errorString = error.error.message;
        } else if (typeof(error.error) === "string") {
            errorString = error.error;
        }
    }
    return errorString;
}

export function updateStatus(params: StatusParams): Promise<string> {
    const requestOptions: rpn.OptionsWithUri = {
        method: "POST",
        uri:
            [
                "https://api.github.com/repos",
                params.repo,
                "statuses",
                params.commitHash,
            ].join("/"),
        headers: {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": "token " + params.gitHubToken,
            "Content-Type": "application/vnd.github.v3+json",
            "User-Agent": "GitHub-Status-Custom-CloudFormation-Resource",
        },
        body: {
            state: params.state,
            description: "test",
            context: params.context,
        },
        json: true,
    };

    console.log("updateStatus request: " + JSON.stringify(requestOptions));

    return rpn(requestOptions).then((result) => {
        console.log("updateStatus result: " + JSON.stringify(result));
        return result.url;
    }).catch((error) => {
        console.log("Error from GitHub POST: " + JSON.stringify(error));

        return Promise.reject(gitHubErrorToString(error));
    });
}

export function getCurrentStatus(params: StatusParams): Promise<string> {
    const requestOptions: rpn.OptionsWithUri = {
        method: "GET",
        uri:
            [
                "https://api.github.com/repos",
                params.repo,
                "commits",
                params.commitHash,
                "status",
            ].join("/"),
        headers: {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": "token " + params.gitHubToken,
            "Content-Type": "application/vnd.github.v3+json",
            "User-Agent": "GitHub-Status-Custom-CloudFormation-Resource",
        },
        json: true,
    };

    return rpn(requestOptions).then((result) => {
        // result contains an array of statuses, one for each context.
        // We only care about the one context.
        const statusObjectForContext: any = result.statuses.find((statusObject: any) => {
            return statusObject.context === params.context;
        });
        if (statusObjectForContext) {
            return Promise.resolve(statusObjectForContext.state);
        } else {
            return Promise.resolve("");
        }

    }).catch((error) => {
         console.log("Error from GitHub GET: " + JSON.stringify(error));

         return Promise.reject(gitHubErrorToString(error));
    });
}

function sendResponse(
    event: CustomResourceEvent,
    status: "SUCCESS" | "FAILED",
    gitHubStatusURL: string,
    error?: string,
): Promise<void> {
    const responseBody: CustomResourceResponse = {
        Status: status,
        PhysicalResourceId: gitHubStatusURL, // TODO: Return GitHub URL?
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
    };
    if (error) {
        responseBody.Reason = error;
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

    console.log("sendResponse request: " + JSON.stringify(requestOptions));

    return rpn(requestOptions).then((result) => {
        console.log("sendResponse result: " + JSON.stringify(result));
        return;
    });
}

function getActualStateToSend(event: CustomResourceEvent, statusParams: StatusParams): Promise<string> {
    const requestState = event.ResourceProperties.State;

    // If we're deleting a "pending" State that hasn't yet been set to "success" in Github,
    // then set it to "error" instead.

    if (event.RequestType === "Create") {
        return Promise.resolve(requestState);
    }
    if (requestState !== "pending") {
        // If we're deleting a status that started out as anything other than pending,
        // assume it hasn't been changed to pending.  Therefore we don't need to send anything to GitHub.
        return Promise.resolve("");
    }
    return getCurrentStatus(statusParams).then((currentState: string) => {
        if (currentState === "pending") {
            return Promise.resolve("error");
        } else {
            // The status has already been changed from pending.
            return Promise.resolve("");
        }
    });
}

exports.handler = (event: CustomResourceEvent, context: Context, callback: Callback) => {
    console.log("Begin Handler");
    console.log(JSON.stringify(event));

    const statusParams = {
        repo: event.ResourceProperties.Repo,
        context: event.ResourceProperties.Context,
        gitHubToken: event.ResourceProperties.GitHubToken,
        commitHash: event.ResourceProperties.CommitHash,
        state: event.ResourceProperties.State,
    };

    getActualStateToSend(event, statusParams).then((actualStateToSend: string) => {
        if (actualStateToSend) {
            statusParams.state = actualStateToSend;
            return updateStatus(statusParams);
        } else {
            return Promise.resolve(event.PhysicalResourceId);
        }
    }).then((statusURL: string) => {
        return sendResponse(event, "SUCCESS", statusURL);
    }).then(() => {
        callback();
        return;
    }).catch( (error) => {
        return sendResponse(event, "FAILED", "", error).catch().then(() => {
            callback(error);
        });
    });
};
