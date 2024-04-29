import { UserInfo, ConstituentStatus, EntryPoint } from './types';

export default interface Constituent {
    info: UserInfo | null | undefined;
    // Constituent's status in relation to this client
    // for this API call.
    status: ConstituentStatus;
    id: string;
    phoneNumber: string;
    // Whether the constituent is on the opt out list.
    onOptOutList: boolean;
    // The message from the constituent in the current request.
    message: string;
    // Whether this is the first time we're seeing this user.
    known: boolean | undefined;
}