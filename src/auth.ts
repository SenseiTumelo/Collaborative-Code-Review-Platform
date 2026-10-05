import jwt from 'jsonwebtoken';
export type Identity = { id: number; role: 'reviewer' | 'submitter' };

export function verifyToken(token: string, secret: string): Identity {
    const value = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof value === 'string' || typeof value.id !== 'number' || !['reviewer', 'submitter'].includes(value.role)) throw new Error('Invalid token');
    return { id: value.id, role: value.role };
}
