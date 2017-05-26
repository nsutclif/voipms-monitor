import * as AWS from "aws-sdk";
import { DocumentClient, GetItemInput, GetItemOutput } from "aws-sdk/clients/dynamodb";
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
    return {
        registered: status.registered,
        registrations: status.registrations.map((registration: Registration): FocusedRegistration => {
            return {
                server_shortname: registration.server_shortname,
                register_ip: registration.register_ip,
            };
        }),
    };
}

function getPreviousRegistration(
    documentClient: DocumentClient,
    tableName: string,
    account: string,
): Promise<FocusedRegistrationStatus> {
    return Promise.resolve().then( () => {
        const requestParams: GetItemInput = {
            TableName: tableName,
            Key: { account },
        };
        return documentClient.get(requestParams).promise();
    }).then( (dynamoResult: GetItemOutput) => {
        return getRegistrationForComparison(dynamoResult.Item as any);
    });
}

export function pollVoipms(
    user: string,
    password: string,
    account: string,
    registrationStatusTableName: string,
): Promise<void> {
    const documentClient = new AWS.DynamoDB.DocumentClient();

    return Promise.all([
        getPreviousRegistration(documentClient, registrationStatusTableName, account),
        requestCurrentRegistrationStatus(user, password, account),
    ]).then( (results: FocusedRegistrationStatus[]) => {
        console.log(results);
    });
}
