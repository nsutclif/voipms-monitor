"use strict";

// Lambda doesn't contain either aws cli or zip command
// Using Gulp was the easiest workaround I could find...

import * as AWS from "aws-sdk";
import {
    CopyObjectRequest,
    ListObjectsV2Output,
    ListObjectsV2Request,
    Object,
} from "aws-sdk/clients/s3";

import * as gulp from "gulp";
import * as gulpS3 from "gulp-s3-upload";
import * as zip from "gulp-zip";

const BUCKET_NAME = "lambci-buildresults-ga8wy7gvebrx"; // TODO: Don't hard-code this!
const TEST_BUCKET_NAME = "voipms-monitor-test-input";
const CODE_KEY_NAME = "PollVoipMSFunction.zip";
const MAIN_TEMPLATE_NAME = "template.yml";
const SQS_REDIRECT_TEMPLATE_NAME = "sqsredirectedtemplate.yml";
const TEST_TEMPLATE_NAME = "testtemplate.yml";

const buildName: string = process.env.LAMBCI_BUILD_NUM || "local";

function prependKeyPrefix(relativeFilename: string): string {
    return [ // TODO: Don't hard code this?
        "gh",
        process.env.LAMBCI_REPO || "nsutclif/voipms-monitor",
        "builds",
        buildName,
        relativeFilename,
    ].join("/");
}

function constructS3URL(keyName: string): string {
    return ["https://s3.amazonaws.com", BUCKET_NAME, keyName].join("/");
}

gulp.task("package", () => {
    function logCompletedFile(keyname: string): void {
        console.log(constructS3URL(keyname));
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

gulp.task("deploytest", (done) => {
    const s3 = new AWS.S3();

    const listParams: ListObjectsV2Request = {
        Bucket: BUCKET_NAME,
        Prefix: prependKeyPrefix(""),
    };

    // Copy all the contents of the build directory over to the bucket in the test sandbox account:
    s3.listObjectsV2(listParams).promise().then( (output: ListObjectsV2Output) => {
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

            return s3.copyObject(copyParams).promise();
        }));
    }).then(() => {
        done();
    }).catch((error) => {
        done(error);
    });
});
