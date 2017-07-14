import * as AWS from "aws-sdk";
import { PublishInput } from "aws-sdk/clients/sns";
import { DocumentClient } from "aws-sdk/lib/dynamodb/document_client";
import * as rpn from "request-promise-native";

// "https://voip.ms/api/v1/rest.php
// ?api_username=john@domain.com&api_password=password&method=getServersInfo&server_pop=1"

interface Registration {
    server_name: string;
    server_shortname: string;
    server_hostname: string;
    server_ip: string;
    server_country: string;
    server_pop: string;
    register_ip: string;
    register_port: string;
    register_next: string;
}

interface RegistrationStatus {
    status: string;
    registered: string;
    registrations: Registration[];
}

function requestCurrentRegistrationStatus(
    user: string,
    password: string,
    account: string,
): Promise<RegistrationStatus> {
    const rpcURL: string =
        "https://voip.ms/api/v1/rest.php?" +
        "api_username=" + user +
        "&api_password=" + password +
        "&method=getRegistrationStatus" +
        "&account=" + account;
    return rpn(rpcURL).then((result: string) => {
        return Promise.resolve(JSON.parse(result));
    });
}

function getPreviousRegistration(
    documentClient: DocumentClient,
    tableName: string,
    account: string,
): Promise<RegistrationStatus> {
    return Promise.resolve().then(() => {
        const requestParams: DocumentClient.GetItemInput = {
            TableName: tableName,
            Key: { account },
        };
        console.log("Gettting Previous Registration: " + JSON.stringify(requestParams));
        return documentClient.get(requestParams).promise();
    }).then((dynamoResult: DocumentClient.GetItemOutput) => {
        if (dynamoResult.Item) {
            return Promise.resolve(dynamoResult.Item.registrationStatus);
        } else {
            return Promise.resolve(undefined);
        }
    });
}

function saveRegistration(
    documentClient: DocumentClient,
    tableName: string,
    account: string,
    registrationStatus: RegistrationStatus,
): Promise<void> {
    return Promise.resolve().then(() => {
        const requestParams: DocumentClient.PutItemInput = {
            TableName: tableName,
            Item: {
                account,
                registrationStatus,
            },
        };
        console.log("Saving Previous Registration: " + JSON.stringify(requestParams));
        return documentClient.put(requestParams).promise();
    }).then(() => {
        return Promise.resolve();
    });
}

function publishChange(
    message: string,
    region: string,
    registrationStatusChangeTopic: string,
): Promise<void> {
    const sns = new AWS.SNS({region});
    return Promise.resolve().then(() => {
        const requestParams: PublishInput = {
            Subject: "Voip.ms registration status change",
            Message: message,
            TopicArn: registrationStatusChangeTopic,
        };
        console.log("Publishing to SNS Topic: " + JSON.stringify(requestParams));
        return sns.publish(requestParams).promise();
    }).then(() => {
        return Promise.resolve();
    });
}

function getSortedIPList(registrations: Registration[]): string {
    if (!registrations || !registrations.length) {
        return "";
    } else {
        return registrations.map((registration) => {
            return registration.register_ip;
        }).sort().join(",");
    }
}

export function pollVoipms(
    user: string,
    password: string,
    account: string,
    region: string,
    registrationStatusTableName: string,
    registrationStatusChangeTopic: string,
): Promise<void> {
    if (!user || !password || !account) {
        return Promise.reject("Must provide a user, password and account");
    }

    console.log("Creating document client in region: " + region);
    const documentClient = new AWS.DynamoDB.DocumentClient({region});

    return Promise.all([
        getPreviousRegistration(documentClient, registrationStatusTableName, account),
        requestCurrentRegistrationStatus(user, password, account),
    ]).then( (results: RegistrationStatus[]) => {
        const previousStatus: RegistrationStatus = results[0];
        const currentStatus: RegistrationStatus = results[1];

        let message: string = "";

        let previousRegisteredIPs: string = "";
        if (previousStatus) {
            previousRegisteredIPs = getSortedIPList(previousStatus.registrations);
        }
        const currentRegisteredIPs = getSortedIPList(currentStatus.registrations);

        if (currentStatus.status !== "success") {
            // Only report this eror if it's new.
            if (!previousStatus || previousStatus.status !== currentStatus.status) {
                message = "Error checking registration status: " + currentStatus.status;
            }
        } else if (!previousStatus) {
            // This is the first time we've checked the status.
            if (currentStatus.registered === "yes") {
                if (!currentStatus.registrations.length) {
                    throw new Error("Unexpected response: registered=true but registrations is empty");
                }

                message = "Registered at " + currentRegisteredIPs;
            } else {
                message = "Not registered.";
            }
        } else if (previousStatus.registered !== currentStatus.registered) {
            if (currentStatus.registered === "yes") {
                message = "Now registered at " + currentRegisteredIPs;
            } else {
                message = "No longer registered.";
            }
        } else if (previousRegisteredIPs !== currentRegisteredIPs) {
            message =
                "IP Addresss changed.\n" +
                "Was at " + previousRegisteredIPs + "\n" +
                "Now at " + currentRegisteredIPs;
        }

        if (message) {
            console.log(message);
            return Promise.all([
                saveRegistration(documentClient, registrationStatusTableName, account, currentStatus),
                publishChange(message, region, registrationStatusChangeTopic),
            ]);
        } else {
            console.log("No Difference");
        }
    }).then(() => {
        return;
    });
}
