"use strict";

// Lambda doesn't contain either aws cli or zip command
// Using Gulp was the easiest workaround I could find...

import * as AWS from "aws-sdk";
import {
    CreateStackInput,
    CreateStackOutput,
} from "aws-sdk/clients/cloudformation";
import {
    CopyObjectRequest,
    ListObjectsV2Output,
    ListObjectsV2Request,
    Object,
} from "aws-sdk/clients/s3";
import {
    AssumeRoleRequest,
    AssumeRoleResponse,
} from "aws-sdk/clients/sts";

import * as gulp from "gulp";
import * as gulpS3 from "gulp-s3-upload";
import * as zip from "gulp-zip";

const BUCKET_NAME = "lambci-buildresults-ga8wy7gvebrx"; // TODO: Don't hard-code this!
const TEST_BUCKET_NAME = "voipms-monitor-test-input";
const CODE_KEY_NAME = "PollVoipMSFunction.zip";
const MAIN_TEMPLATE_NAME = "template.yml";
const SQS_REDIRECT_TEMPLATE_NAME = "sqsredirectedtemplate.yml";
const TEST_TEMPLATE_NAME = "testtemplate.yml";
const TEST_ACCOUNT_STACK_DEPLOY_ROLE = "arn:aws:iam::729398747886:role/test-account-stack-deploy-role";

// TODO: Remove the defaults and rely on launch.json?
const buildName: string = process.env.LAMBCI_BUILD_NUM || "local";
const repoName: string = process.env.LAMBCI_REPO || "nsutclif/voipms-monitor";

function prependKeyPrefix(relativeFilename: string): string {
    return [ // TODO: Don't hard code this?
        "gh",
        repoName,
        "builds",
        buildName,
        relativeFilename,
    ].join("/");
}

function constructS3URL(bucketName, keyName: string): string {
    return ["https://s3.amazonaws.com", bucketName, keyName].join("/");
}

gulp.task("package", () => {
    function logCompletedFile(keyname: string): void {
        console.log(constructS3URL(BUCKET_NAME, keyname));
    }

    gulp.src("../packaged/**/*")
        .pipe(zip(CODE_KEY_NAME))
        .pipe(gulpS3()({
            Bucket: BUCKET_NAME,
            keyTransform: prependKeyPrefix,
        }));
    gulp.src("../cloudformation/*.yml")
        .pipe(gulpS3()({
            Bucket: BUCKET_NAME,
            keyTransform: prependKeyPrefix,
            onChange: logCompletedFile,
            onNoChange: logCompletedFile,
            onNew: logCompletedFile,
        }));
    },
);

function copyBuildToTestAccount(): Promise<void> {
    const s3 = new AWS.S3();

    const listParams: ListObjectsV2Request = {
        Bucket: BUCKET_NAME,
        Prefix: prependKeyPrefix(""),
    };

    return s3.listObjectsV2(listParams).promise().then((output: ListObjectsV2Output) => {
        // tslint:disable-next-line:ban-types
        return Promise.all(output.Contents.map((content: Object) => {
            const keyParts = content.Key.split("/");
            const objectNameOnly = keyParts[keyParts.length - 1];

            const copyParams: CopyObjectRequest = {
                Bucket: TEST_BUCKET_NAME,
                CopySource: [BUCKET_NAME, content.Key].join("/"),
                Key: [buildName, objectNameOnly].join("/"),
                ACL: "bucket-owner-full-control",
            };

            console.log("Attempting to copy: " + JSON.stringify(copyParams));

            return s3.copyObject(copyParams).promise();
        }));
    }).then(() => {
        return;
    });
}

function deployBuildInTestAccount(): Promise<void> {
    const sts = new AWS.STS();

    const assumeRoleParams: AssumeRoleRequest = {
        RoleArn: TEST_ACCOUNT_STACK_DEPLOY_ROLE,
        RoleSessionName: "test-deploy",
    };
    return sts.assumeRole(assumeRoleParams).promise().then((assumedRole: AssumeRoleResponse) => {
        // TypeScript doesn't think ClientConfiguration wants assumedRole.Credentials directly.
        const credentials = new AWS.Credentials({
            accessKeyId: assumedRole.Credentials.AccessKeyId,
            secretAccessKey: assumedRole.Credentials.SecretAccessKey,
            sessionToken: assumedRole.Credentials.SessionToken,
        });

        const cf = new AWS.CloudFormation({credentials});

        const createStackParams: CreateStackInput = {
            StackName: "voipms-test-" + buildName,
            TemplateURL: constructS3URL(TEST_BUCKET_NAME, [buildName, TEST_TEMPLATE_NAME].join("/")),
            Parameters: [
                {
                    ParameterKey: "StackTemplateBucketName",
                    ParameterValue: TEST_BUCKET_NAME,
                },
                {
                    ParameterKey: "StackTemplateBucketKeyPrefix",
                    ParameterValue: buildName,
                },
                {
                    ParameterKey: "Repo",
                    ParameterValue: repoName,
                },
                {
                    ParameterKey: "GitHubToken",
                    ParameterValue: process.env.GITHUB_TOKEN,
                },
                {
                    ParameterKey: "CommitHash",
                    ParameterValue: process.env.LAMBCI_COMMIT,
                },
            ],
            DisableRollback: true,
            Capabilities: [
                "CAPABILITY_NAMED_IAM",
            ],
            Tags: [
                {
                    Key: "BUILD",
                    Value: buildName,
                },
            ],
        };
        if (process.env.LAMBCI_BRANCH) {
            createStackParams.Tags.push(
                {
                    Key: "BRANCH",
                    Value: process.env.LAMBCI_BRANCH,
                },
            );
        }
        if (process.env.LAMBCI_COMMIT) {
            createStackParams.Tags.push(
                {
                    Key: "COMMIT",
                    Value: process.env.LAMBCI_COMMIT,
                },
            );
        }
        if (process.env.LAMBCI_BRANCH) {
            createStackParams.Tags.push(
                {
                    Key: "PULL_REQUEST",
                    Value: process.env.LAMBCI_PULL_REQUEST,
                },
            );
        }

        console.log("Attempting to create stack: " + JSON.stringify(createStackParams));

        return cf.createStack(createStackParams).promise();
    }).then(() => {
        return;
    });
}

gulp.task("deploytest", (done) => {
    // Copy all the contents of the build directory over to the bucket in the test sandbox account:
    copyBuildToTestAccount().then(() => {
        return deployBuildInTestAccount();
    }).then(() => {
        done();
    }).catch((error) => {
        done(error);
    });
});
