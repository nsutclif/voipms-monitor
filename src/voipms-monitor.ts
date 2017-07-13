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

interface FocusedRegistration {
    server_shortname: string;
    register_ip: string;
}

interface FocusedRegistrationStatus {
    registered: string;
    registrations: FocusedRegistration[];
}

function requestCurrentRegistrationStatus(
    user: string,
    password: string,
    account: string,
): Promise<FocusedRegistrationStatus> {
    const rpcURL: string =
        "https://voip.ms/api/v1/rest.php?" +
        "api_username=" + user +
        "&api_password=" + password +
        "&method=getRegistrationStatus" +
        "&account=" + account;
    return rpn(rpcURL).then( (result: string) => {
        return getRegistrationForComparison(JSON.parse(result));
    });
}

function getRegistrationForComparison(status: RegistrationStatus): FocusedRegistrationStatus {
    let registrations: FocusedRegistration[];
    if (Array.isArray(status.registrations)) {
        registrations = status.registrations.map((registration: Registration): FocusedRegistration => {
            return {
                server_shortname: registration.server_shortname,
                register_ip: registration.register_ip,
            };
        });
    }
    if (status) {
        return {
            registered: status.registered,
            registrations,
        };
    } else {
        return;
    }
}

function getPreviousRegistration(
    documentClient: DocumentClient,
    tableName: string,
    account: string,
): Promise<FocusedRegistrationStatus> {
    return Promise.resolve().then(() => {
        const requestParams: DocumentClient.GetItemInput = {
            TableName: tableName,
            Key: { account },
        };
        console.log("Gettting Previous Registration: " + JSON.stringify(requestParams));
        return documentClient.get(requestParams).promise();
    }).then((dynamoResult: DocumentClient.GetItemOutput) => {
        if (dynamoResult.Item) {
            return getRegistrationForComparison(dynamoResult.Item.registrationStatus as any);
        } else {
            return Promise.resolve(undefined);
        }
    });
}

function saveRegistration(
    documentClient: DocumentClient,
    tableName: string,
    account: string,
    registrationStatus: FocusedRegistrationStatus,
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

function getSortedIPList(registrations: FocusedRegistration[]): string {
    if (!registrations.length) {
        return "";
    } else {
        return registrations.sort((a, b) => {
            if (a.register_ip < b.register_ip) {
                return -1;
            } else if (a.register_ip > b.register_ip) {
                return 1;
            } else {
                return 0;
            }
        }).join(",");
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
    ]).then( (results: FocusedRegistrationStatus[]) => {
        const previousStatus: FocusedRegistrationStatus = results[0];
        const currentStatus: FocusedRegistrationStatus = results[1];

        let message: string = "";

        let previousRegisteredIPs: string = "";
        if (previousStatus) {
            previousRegisteredIPs = getSortedIPList(previousStatus.registrations);
        }
        const currentRegisteredIPs = getSortedIPList(currentStatus.registrations);

        if (!previousStatus && currentStatus.registered) {
            if (!currentStatus.registrations.length) {
                throw new Error("Unexpected response: registered=true but registrations is empty");
            }

            message = "Newly registered at " + currentRegisteredIPs;
        } else if (!currentStatus.registered) {
            message = "No longer registered.";
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
