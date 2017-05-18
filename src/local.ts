import {pollVoipms} from "./voipms-monitor";

pollVoipms(process.env.USER, process.env.PASSWORD, process.env.ACCOUNT).then( () => {
        console.log("Complete");
    }).catch( (error) => {
        console.log(error);
    });
