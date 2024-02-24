import { UserInfo, ConstituentStatus } from './types';

export default interface Constituent {
    info: UserInfo | null | undefined;
    // Constituent's status in relation to this client
    // for this API call.
    status: ConstituentStatus;
    id: string;
    phoneNumber: string;
    // Whether the constituent is on the opt out list.
    onOptOutList: boolean;
    message: string | undefined;
}